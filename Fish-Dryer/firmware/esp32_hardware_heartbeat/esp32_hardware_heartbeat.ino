/**
 * Fish Dryer — ESP32 hardware heartbeat → Laravel
 *
 * POST /api/hardware/esp32/status (JSON)
 *
 * Fixes vs naive sketch:
 * - Relays assumed ACTIVE-LOW: default OFF = GPIO HIGH (nothing energized at boot).
 * - Optional bench self-test only if ENABLE_POWER_ON_SELFTEST is 1.
 * - If MICROCONTROLLER_ID > 0, device_id is OMITTED from JSON (heartbeat targets that row).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "DHT.h"
#include "HX711.h"

// ================= WIFI / API (set these before flashing) =================
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Laravel host (PC running `php artisan serve` / Apache). Same LAN as ESP32.
const char* API_URL = "http://10.207.70.15:8000/api/hardware/esp32/status";

// Used only when MICROCONTROLLER_ID is 0 (device-id lookup / new row fallback).
const char* DEVICE_ID = "Fish Dryer 1";

// MUST match microcontrollers.id (see GET /api/machines). Prefer > 0 and omit device_id in JSON.
const int MICROCONTROLLER_ID = 4;

/** Set 1 only on a safe bench — turns on relays/LEDs/buzzer at boot for wiring checks. */
#ifndef ENABLE_POWER_ON_SELFTEST
#define ENABLE_POWER_ON_SELFTEST 0
#endif

// ================= OUTPUTS =================
#define LED1 13
#define LED2 12
#define LED3 14
#define BUZZER 27

#define FAN1 26
#define FAN2 25
#define FAN3 33

#define HEATER1 32
#define HEATER2 15

// ================= SENSORS =================
#define DHTPIN 4
#define DHTTYPE DHT22
#define SOLAR_PIN 34

#define DT1 18
#define SCK1 19

#define DT2 21
#define SCK2 22

DHT dht(DHTPIN, DHTTYPE);
HX711 scale1;
HX711 scale2;

unsigned long lastHeartbeatMs = 0;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000;

String statusWord(bool ok) { return ok ? "working" : "not_working"; }

// Relays ACTIVE LOW: LOW = ON, HIGH = OFF
bool relayOn(int pin) { return digitalRead(pin) == LOW; }

void connectWifiBlocking(uint32_t timeoutMs = 15000) {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting WiFi");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi not connected.");
  }
}

bool postJsonWithRetries(const String& payload, int retries = 3) {
  for (int attempt = 1; attempt <= retries; attempt++) {
    if (WiFi.status() != WL_CONNECTED) {
      connectWifiBlocking();
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("POST skipped: WiFi unavailable");
        delay(500);
        continue;
      }
    }

    HTTPClient http;
    http.setTimeout(8000);
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");

    Serial.print("Posting heartbeat (attempt ");
    Serial.print(attempt);
    Serial.println(")...");

    int code = http.POST(payload);
    String resp = http.getString();

    Serial.print("Heartbeat HTTP: ");
    Serial.println(code);
    Serial.print("Heartbeat Resp: ");
    Serial.println(resp);

    http.end();

    if (code >= 200 && code < 300) return true;

    delay(500);
  }
  return false;
}

void sendHeartbeat(bool dhtOk, bool lc1Ok, bool lc2Ok, bool solarOk) {
  String payload;
  payload.reserve(900);

  payload += "{";
  payload += "\"microcontroller_id\":";
  payload += MICROCONTROLLER_ID;

  // device_id omitted when MICROCONTROLLER_ID > 0 so heartbeats always target that DB row.
  if (MICROCONTROLLER_ID <= 0) {
    payload += ",\"device_id\":\"";
    payload += DEVICE_ID;
    payload += "\"";
  }

  payload += ",\"components\":{";

  payload += "\"esp32\":\"working\",";
  payload += "\"temp_humidity_sensor\":\"";
  payload += statusWord(dhtOk);
  payload += "\",";
  payload += "\"moisture_sensor_1\":\"";
  payload += statusWord(lc1Ok);
  payload += "\",";
  payload += "\"moisture_sensor_2\":\"";
  payload += statusWord(lc2Ok);
  payload += "\",";
  payload += "\"solar_panel\":\"";
  payload += statusWord(solarOk);
  payload += "\",";

  payload += "\"heater_fan_1\":\"";
  payload += statusWord(relayOn(FAN1));
  payload += "\",";
  payload += "\"heater_fan_2\":\"";
  payload += statusWord(relayOn(FAN2));
  payload += "\",";
  payload += "\"ventilation_fan\":\"";
  payload += statusWord(relayOn(FAN3));
  payload += "\",";
  payload += "\"heater_1\":\"";
  payload += statusWord(relayOn(HEATER1));
  payload += "\",";
  payload += "\"heater_2\":\"";
  payload += statusWord(relayOn(HEATER2));
  payload += "\",";

  payload += "\"buzzer\":\"";
  payload += statusWord(digitalRead(BUZZER) == HIGH);
  payload += "\",";
  payload += "\"led_1\":\"";
  payload += statusWord(digitalRead(LED1) == HIGH);
  payload += "\",";
  payload += "\"led_2\":\"";
  payload += statusWord(digitalRead(LED2) == HIGH);
  payload += "\",";
  payload += "\"led_3\":\"";
  payload += statusWord(digitalRead(LED3) == HIGH);
  payload += "\"";

  payload += "}";
  payload += "}";

  postJsonWithRetries(payload, 3);
}

static void applySafeOutputDefaults() {
  digitalWrite(LED1, LOW);
  digitalWrite(LED2, LOW);
  digitalWrite(LED3, LOW);
  digitalWrite(BUZZER, LOW);

  digitalWrite(FAN1, HIGH);
  digitalWrite(FAN2, HIGH);
  digitalWrite(FAN3, HIGH);
  digitalWrite(HEATER1, HIGH);
  digitalWrite(HEATER2, HIGH);
}

#if ENABLE_POWER_ON_SELFTEST
static void applyBenchSelfTestOutputs() {
  digitalWrite(LED1, HIGH);
  digitalWrite(LED2, HIGH);
  digitalWrite(LED3, HIGH);
  digitalWrite(BUZZER, HIGH);

  digitalWrite(FAN1, LOW);
  digitalWrite(FAN2, LOW);
  digitalWrite(FAN3, LOW);
  digitalWrite(HEATER1, LOW);
  digitalWrite(HEATER2, LOW);
}
#endif

static void readSensorsOnce(bool& dhtOk, bool& lc1Ok, bool& lc2Ok, bool& solarOk) {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  dhtOk = !(isnan(t) || isnan(h));

  lc1Ok = scale1.is_ready();
  if (lc1Ok) (void)scale1.get_units(1);

  lc2Ok = scale2.is_ready();
  if (lc2Ok) (void)scale2.get_units(1);

  int solarRaw = analogRead(SOLAR_PIN);
  solarOk = solarRaw > 50;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("Reset reason: %d\n", (int)esp_reset_reason());

  connectWifiBlocking();

  pinMode(LED1, OUTPUT);
  pinMode(LED2, OUTPUT);
  pinMode(LED3, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  pinMode(FAN1, OUTPUT);
  pinMode(FAN2, OUTPUT);
  pinMode(FAN3, OUTPUT);

  pinMode(HEATER1, OUTPUT);
  pinMode(HEATER2, OUTPUT);

  applySafeOutputDefaults();

#if ENABLE_POWER_ON_SELFTEST
  applyBenchSelfTestOutputs();
#endif

  dht.begin();

  scale1.begin(DT1, SCK1);
  scale1.set_scale(1000.f);
  scale1.tare();

  scale2.begin(DT2, SCK2);
  scale2.set_scale(1000.f);
  scale2.tare();

  delay(500);

  Serial.println("=== HEARTBEAT START ===");

  bool dhtOk = false, lc1Ok = false, lc2Ok = false, solarOk = false;
  readSensorsOnce(dhtOk, lc1Ok, lc2Ok, solarOk);
  sendHeartbeat(dhtOk, lc1Ok, lc2Ok, solarOk);
  lastHeartbeatMs = millis();
}

void loop() {
  bool dhtOk = false, lc1Ok = false, lc2Ok = false, solarOk = false;
  readSensorsOnce(dhtOk, lc1Ok, lc2Ok, solarOk);

  if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat(dhtOk, lc1Ok, lc2Ok, solarOk);
    lastHeartbeatMs = millis();
  }

  delay(200);
}
