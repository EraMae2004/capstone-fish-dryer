      #include <WiFi.h>
      #include <HTTPClient.h>
      #include <WiFiClientSecure.h>
      #include <Preferences.h>
      #include "DHT.h"
      #include <time.h>
      #include "esp_timer.h"

      // ============================================================================
      //                       IDENTITY & ASSIGNMENT (NO HARDCODE)
      // ----------------------------------------------------------------------------
      //  This sketch is FLASHED IDENTICALLY to every ESP32 board.
      //  Per-board identity comes from the MAC address. The numeric ID used by the
      //  Laravel + mobile app is assigned AT RUNTIME by the user from the mobile
      //  "Detect → Save" flow:
      //    1. Board boots, advertises itself to RTDB  discovery/{MAC}/...
      //    2. User taps "Detect Microcontrollers" in the app, sees this board.
      //    3. User saves it. App writes  assignments/{MAC} = <numeric id>  to RTDB.
      //    4. Board polls assignments/{MAC} every heartbeat, adopts the id, persists
      //       it to NVS, and starts publishing to  machines/{id}/hardware_status.
      //  No source edits required to add boards.
      // ============================================================================

      static String gDeviceMac;       // "AA:BB:CC:DD:EE:FF"
      static String gDeviceMacSafe;   // "AABBCCDDEEFF"  (path-safe for RTDB)
      static String gDeviceName;      // "Fish Dryer XXXX"  (last 4 hex of MAC)
      static int    gAssignedId = 0;  // 0 = not yet assigned; loaded from NVS
      static Preferences gPrefs;

      /** From RTDB `machines/{id}/session` — "running" / "paused" / "stopped". */
      static String gSessionStatus = "stopped";
      /** Fan demand 1..3 (from same RTDB node). Single relay: time‑multiplexed in `loop()`. */
      static int gFanSpeedLevel = 1;
      /** Drying target °C from RTDB session (used when session is `running`). */
      static float gSessionTargetC = 60.0f;

      // ===== BUZZER — two cases (never when idle / stopped) =====
      //  (1) Active drying + fault: 10 s ON, 10 s silent, repeat until resolved.
      //  (2) hardware-status Test All / Individual → test_command.
      /** Max remote test length (ms). */
      #ifndef HARDWARE_TEST_MAX_MS
      #define HARDWARE_TEST_MAX_MS 12000UL
      #endif
      /** Fault pattern: 10 s ON, 10 s OFF, repeat (20 s cycle). */
      #ifndef ALERT_BUZZ_ON_MS
      #define ALERT_BUZZ_ON_MS 10000UL
      #endif
      #ifndef ALERT_BUZZ_SILENT_MS
      #define ALERT_BUZZ_SILENT_MS 10000UL
      #endif
      /** Below target this long while running → temp fault (30 min). */
      #ifndef TEMP_BELOW_TARGET_FAULT_MS
      #define TEMP_BELOW_TARGET_FAULT_MS (30UL * 60UL * 1000UL)
      #endif
      #ifndef TEMP_TARGET_MARGIN_C
      #define TEMP_TARGET_MARGIN_C 0.5f
      #endif
      #ifndef ALERT_BUZZ_PERIOD_MS
      #define ALERT_BUZZ_PERIOD_MS (ALERT_BUZZ_ON_MS + ALERT_BUZZ_SILENT_MS)
      #endif
      static bool          gBuzzerHwPwmOn = false;
      static bool          gBuzzerAlarmEngaged = false;
      static bool          gBuzzerInOnPhase = false;
      static unsigned long gBuzzerAllGoodSinceMs = 0;
      /** Hardware timer — 10s/10s cycle runs even while HTTP/RTDB blocks the main loop. */
      static esp_timer_handle_t gBuzzerPhaseTimer = nullptr;
      static bool          gDrySessionLatched = false;
      static unsigned long gLastSessionActiveMs = 0;
      static unsigned long gBelowTargetSinceMs = 0;
      /** From RTDB session.fault_buzzer_armed — true only after mobile Start, false on Stop. */
      static bool          gFaultBuzzerArmed = false;
      static bool          gBuzzerPinHigh = false;

      // Remote hardware test from mobile → RTDB `machines/{id}/test_command`.
      static String        gTestMode = "";           // "all" | "component" | ""
      static String        gTestComponent = "";
      static String        gLastTestRequestId = "";
      static unsigned long gTestModeUntilMs = 0;
      static unsigned long gLastTestCmdPollMs = 0;
      static unsigned long gLastSessionPollMs = 0;
      static int           gTestFanLevel = 3;

      // ================= WIFI / API — CHANGE PC IP HERE (must match phone app) =================
      const char* WIFI_SSID = "XuMinghao";
      const char* WIFI_PASS = "Connecthere";

      // PC IPv4 from `ipconfig` + run: php artisan serve --host=0.0.0.0 --port=8000
      // Must match fish-dryer-mobile/app.json -> expo.extra.apiBaseUrl (same IP, ends with /api).
      const char* API_URL = "http://10.173.245.15:8000/api/hardware/esp32/status";

      static const char* FIRMWARE_BUILD_TAG = "steady-led-session-v7";

      // Laravel heartbeat: keeps `last_seen` + hardware rows in MySQL and mirrors RTDB when enabled.
      // Set to 0 only while debugging (e.g. API returns 500). If the app shows "offline" but RTDB
      // discovery updates, this was probably 0 — Laravel never saw a heartbeat.
      #ifndef SEND_TO_LARAVEL
      #define SEND_TO_LARAVEL 1
      #endif

      // ================= FIREBASE (set these before flashing) =================
      // RTDB URL example: https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app/
      // In Firebase RTDB "Test mode", you can write without auth tokens.
      const char* FIREBASE_DATABASE_URL = "https://capstone-fish-dryer-default-rtdb.asia-southeast1.firebasedatabase.app";

      /** Set 1 only on a safe bench — short buzz + outputs (legacy; see WIRING_CHECK_AT_BOOT). */
      #ifndef ENABLE_POWER_ON_SELFTEST
      #define ENABLE_POWER_ON_SELFTEST 0
      #endif

      /**
       * Wiring verification at boot: ALL LEDs + fan + heater relays ON, buzzer chirps,
       * then holds so you can confirm connections. Heaters/fan may run — bench only.
       * Set to 0 after wiring is verified.
       */
      #ifndef WIRING_CHECK_AT_BOOT
      #define WIRING_CHECK_AT_BOOT 0
      #endif
      #ifndef WIRING_CHECK_HOLD_MS
      #define WIRING_CHECK_HOLD_MS 12000UL
      #endif

      /** Brief GREEN→YELLOW→RED sweep at boot (proves wiring). Set 0 to skip. */
      #ifndef LED_BOOT_SWEEP
      #define LED_BOOT_SWEEP 0
      #endif

      // ================= PIN MAP (ESP32) — matches your breadboard build =================
      // YL-69 moisture (probe + board): VCC → 3.3 V, GND → GND, A0/AO → GPIO35.
      //   Screw the YL-69 probe into the board terminals. Board LED = power only — A0 must go to GPIO35.
      //   Wet fish → A0 often reads low; dry → higher. Both are normal. Use 3.3 V (not the 5 V fan rail).
      // DHT22: DATA → GPIO4, GND → GND, VCC → 3.3 V, 10 kΩ pull-up DATA→3.3 V (as you wired).
      //
      // LEDs — use NEW GPIOs (21/22/23 may be damaged from over-current). Each LED:
      //   GPIO → 330–470 Ω resistor → LED anode → LED cathode → GND (same GND as ESP32).
      //   GREEN=GPIO32, YELLOW=GPIO33, RED=GPIO13. Max ~10 mA per LED from 3.3 V GPIO.
      //   NEVER tie LED/resistor to the fan/heater PSU + rail — only the ESP32 GPIO drives them.
      //   Default LED_ON_IS_HIGH=1 (HIGH = on). Set to 0 if common-anode wiring.
      //
      // External switching PSU (fans/heaters): + and − to breadboard load rail ONLY.
      //   Tie PSU GND to ESP32 GND (one common ground). Fans/heaters via relay COM/NO — not GPIO.
      // Fan relay module: VCC/GND to rails, IN → GPIO5; COM → PSU +, NO → fan +, fan − → PSU GND.
      // Heaters (when used): GPIO19 heater1 IN, GPIO18 heater2 IN (same relay polarity as fan).
      // Door reed (optional): GPIO15 + INPUT_PULLUP + reed to GND when closed.
      //   HAVE_DOOR_SENSOR=0 (default): app always shows door_sensor not_working; door is ignored
      //   for fault buzzer until you set HAVE_DOOR_SENSOR=1 after wiring the switch.
      // Passive piezo (GPIO27): + via ~100Ω optional, − to GND. Firmware uses LEDC PWM (~4 kHz).

      // ----- Output polarity (set to match your modules; wrong = “nothing works”) -----
      // Most relay boards: IN pin LOW energizes coil → RELAY_ACTIVE_LOW 1
      #ifndef RELAY_ACTIVE_LOW
      #define RELAY_ACTIVE_LOW 1
      #endif
      // Many LEDs: GPIO sinks current → LED_ON_IS_HIGH 0 (LOW = lit). Set to 1 if your LEDs turn on with HIGH.
      #ifndef LED_ON_IS_HIGH
      #define LED_ON_IS_HIGH 1
      #endif

      /** Set 1 to energize relays/LEDs at boot like the old demo sketch (heaters can run — use only on bench).
       *  For real use: keep this 0 so only RED LED is on when idle and all relays are OFF at boot.
       */
      #ifndef START_WITH_OUTPUTS_ENERGIZED
      #define START_WITH_OUTPUTS_ENERGIZED 0
      #endif

      // ================= OUTPUTS =================
      // Drying-session indicator LEDs:
      //   GREEN  → drying session is RUNNING
      //   YELLOW → drying session is PAUSED
      //   RED    → no drying session (stopped / idle)
      // Default mapping: LED1=GREEN, LED2=YELLOW, LED3=RED (moved off GPIO 21/22/23).
      #define LED1 32   // GREEN — running
      #define LED2 33   // YELLOW — paused
      #define LED3 13   // RED — stopped / idle
      #define LED_GREEN  LED1
      #define LED_YELLOW LED2
      #define LED_RED    LED3

      #define BUZZER_PIN 27

      // Passive piezo only — LEDC square wave (steady through WiFi/HTTP blocking).
      #ifndef BUZZER_TONE_HZ
      #define BUZZER_TONE_HZ 4000
      #endif
      #ifndef BUZZER_PWM_DUTY
      #define BUZZER_PWM_DUTY 128
      #endif
      /** All faults cleared this long before alarm fully stops (keeps 10s/10s cycle locked until then). */
      #ifndef BUZZER_ALARM_DISENGAGE_MS
      #define BUZZER_ALARM_DISENGAGE_MS 30000UL
      #endif
      #ifndef SESSION_ACTIVE_HOLD_MS
      #define SESSION_ACTIVE_HOLD_MS 15000UL
      #endif
      /** Beep at boot so you hear wiring works before any app session (seconds). 0 = off. */
      #ifndef BUZZER_BOOT_TEST_SEC
      #define BUZZER_BOOT_TEST_SEC 0
      #endif

      static bool gBuzzerTonePlaying = false;
      static uint32_t gBuzzerLastToggleUs = 0;
      static bool gBuzzerPinLevel = false;

      // Relays (active-low): LOW = ON, HIGH = OFF
      #define RELAY_FAN 5
      #define RELAY_HEATER1 19
      #define RELAY_HEATER2 18

      // ================= SENSORS =================
      #define DHTPIN 4
      #define DHTTYPE DHT22
      #define MOISTURE_PIN 35
      #define MOISTURE_PIN_ALT 34
      #define REED_PIN 15

      /**
       * Door-sensor presence detection (no user action required).
       *
       * Why digitalRead alone fails: with INPUT_PULLUP, a disconnected GPIO15 and a connected
       * reed with the door open BOTH read steady HIGH. There's no electrical difference visible
       * via digitalRead, so the old check falsely reported "working" with nothing connected.
       *
       * Trick: GPIO15 is also touch channel T3. Touch reads measure parasitic capacitance.
       * A bare floating pin has very low capacitance (touchRead returns a HIGH count, e.g. 70–95).
       * Even a short reed cable adds enough capacitance to drop the count noticeably (≈ 30–60).
       * We sample touchRead(T3) every heartbeat, restore INPUT_PULLUP, then run the jitter test.
       *
       * Threshold is conservative: anything reading ABOVE this count is treated as "no wire
       * connected". Default was 90; short reed leads often still read >90 → false "unplugged".
       * Raise toward ~130 if the door shows not_working with a real switch wired.
       */
      #ifndef DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD
      #define DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD 120
      #endif

      /** Set 1 to skip the touch "wire present" test and only use digital stability (reed only). */
      #ifndef DOOR_SENSOR_SKIP_TOUCH_CHECK
      #define DOOR_SENSOR_SKIP_TOUCH_CHECK 0
      #endif

      /** Max LOW/HIGH toggles during the jitter window; raise if a noisy line fails a good sensor. */
      #ifndef DOOR_SENSOR_MAX_JITTER_TRANSITIONS
      #define DOOR_SENSOR_MAX_JITTER_TRANSITIONS 48
      #endif

      /**
       * 0 = no door hardware in this build: always publish door_sensor as not_working and do not
       *     count the door in the fault buzzer (GPIO15 may float).
       * 1 = reed wired on GPIO15: run doorSensorElectricalOk() for status + alerts.
       */
      #ifndef HAVE_DOOR_SENSOR
      #define HAVE_DOOR_SENSOR 0
      #endif

      /** Touch channel for GPIO15. (ESP32 classic mapping.) */
      #ifndef REED_TOUCH_CHANNEL
      #define REED_TOUCH_CHANNEL T3
      #endif

      DHT dht(DHTPIN, DHTTYPE);

      unsigned long lastHeartbeatMs = 0;
      /** Just above DHT_MIN_INTERVAL_MS so every heartbeat can refresh DHT + RTDB without violating the 2s DHT rule. */
      const unsigned long HEARTBEAT_INTERVAL_MS = 2100;

      // DHT22 requires ≥ ~2 s between reads; polling faster returns NaN and makes status flicker.
      static unsigned long lastDhtPollMs = 0;
      static float cachedDhtT = NAN;
      static float cachedDhtH = NAN;
      static bool lastDhtReadOk = false;

      static inline void driveLed(int pin, bool on) {
        pinMode(pin, OUTPUT);
        const bool levelHigh = LED_ON_IS_HIGH ? on : !on;
        digitalWrite(pin, levelHigh ? HIGH : LOW);
      }

      static inline void driveRelay(int pin, bool on) {
        pinMode(pin, OUTPUT);
        const bool levelHigh = RELAY_ACTIVE_LOW ? !on : on;
        digitalWrite(pin, levelHigh ? HIGH : LOW);
      }

      /** Obey DHT22 sampling interval (≥2 s); must align with HEARTBEAT_INTERVAL_MS to avoid stale NaN. */
      static const unsigned long DHT_MIN_INTERVAL_MS = 2000;

      /** Obey DHT22 sampling interval; refresh only when due. Returns true iff the most recent
       *  read succeeded (plausible T/H). On failure, clears cached values so the app does not
       *  keep showing old numbers after unplug. */
      static bool dhtReadPlausible(float t, float h) {
        if (isnan(t) || isnan(h)) return false;
        // Unplugged / floating DATA often returns 0,0 or tiny values — not a real DHT22 frame.
        if (t <= 1.0f && h <= 1.0f) return false;
        if (t == 0.0f && h == 0.0f) return false;
        return t >= -45.0f && t <= 85.0f && h >= 1.0f && h <= 100.0f;
      }

      static bool pollDhtIfDue() {
        const unsigned long now = millis();
        if (lastDhtPollMs != 0 && (now - lastDhtPollMs) < DHT_MIN_INTERVAL_MS) {
          return lastDhtReadOk;
        }

        // ESP32 Wi‑Fi stack can disturb the DHT one‑wire timing. Let the radio yield, then read
        // in the order the Adafruit examples use (humidity first, then temperature).
        yield();
        delay(50);
        const float h = dht.readHumidity();
        const float t = dht.readTemperature();
        const bool plausible = dhtReadPlausible(t, h);

        // Timestamp after the acquisition so the next poll is ≥2 s later (library also enforces).
        lastDhtPollMs = millis();

        lastDhtReadOk = plausible;
        if (plausible) {
          cachedDhtT = t;
          cachedDhtH = h;
        } else {
          cachedDhtT = NAN;
          cachedDhtH = NAN;
        }
        return lastDhtReadOk;
      }

      String statusWord(bool ok) { return ok ? "working" : "not_working"; }
      String statusUnknown() { return "unknown"; }

      // ===== Moisture calibration (ADC → %) =====
      // Self-calibrating bounds: learned over time from observed readings.
      // (Prevents wrong % when you can't provide wet/dry constants up front.)
      static int MOISTURE_DRY_ADC = 3000; // will be updated upward
      static int MOISTURE_WET_ADC = 1500; // will be updated downward
      static bool moistureBoundsInitialized = false;

      static int clampInt(int v, int lo, int hi) {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
      }

      static void updateMoistureBounds(int adc) {
        if (!moistureBoundsInitialized) {
          MOISTURE_DRY_ADC = adc + 200;
          MOISTURE_WET_ADC = adc - 200;
          if (MOISTURE_WET_ADC < 0) MOISTURE_WET_ADC = 0;
          if (MOISTURE_DRY_ADC > 4095) MOISTURE_DRY_ADC = 4095;
          moistureBoundsInitialized = true;
          return;
        }

        // Expand bounds slowly to avoid spikes.
        if (adc > MOISTURE_DRY_ADC) MOISTURE_DRY_ADC = adc;
        if (adc < MOISTURE_WET_ADC) MOISTURE_WET_ADC = adc;

        // Keep a minimum span so percent doesn't explode.
        if (abs(MOISTURE_DRY_ADC - MOISTURE_WET_ADC) < 200) {
          MOISTURE_DRY_ADC += 100;
          MOISTURE_WET_ADC -= 100;
          if (MOISTURE_WET_ADC < 0) MOISTURE_WET_ADC = 0;
          if (MOISTURE_DRY_ADC > 4095) MOISTURE_DRY_ADC = 4095;
        }
      }

      // YL-69 A0: lower ADC = wetter, higher ADC = drier (dry air/probe often ~3500–4095).
      #ifndef MOISTURE_YL69_DRY_ADC
      #define MOISTURE_YL69_DRY_ADC 4095
      #endif
      #ifndef MOISTURE_YL69_WET_ADC
      #define MOISTURE_YL69_WET_ADC 1200
      #endif
      #ifndef MOISTURE_LEARNED_SPAN_MIN
      #define MOISTURE_LEARNED_SPAN_MIN 800
      #endif

      static int moisturePercentFromAdc(int adc) {
        int dry = MOISTURE_YL69_DRY_ADC;
        int wet = MOISTURE_YL69_WET_ADC;
        const int spanLearned = abs(MOISTURE_DRY_ADC - MOISTURE_WET_ADC);
        if (moistureBoundsInitialized && spanLearned >= MOISTURE_LEARNED_SPAN_MIN) {
          dry = MOISTURE_DRY_ADC;
          wet = MOISTURE_WET_ADC;
        }
        if (dry == wet) return 0;

        float pct;
        if (dry > wet) {
          pct = (float)(dry - adc) * 100.0f / (float)(dry - wet);
        } else {
          pct = (float)(adc - dry) * 100.0f / (float)(wet - dry);
        }
        return clampInt((int)lroundf(pct), 0, 100);
      }

      #ifndef MOISTURE_ADC_SAMPLES
      #define MOISTURE_ADC_SAMPLES 24
      #endif

      #ifndef MOISTURE_FLOAT_SPREAD_FAIL
      /** Unwired GPIO35 often jitters; a connected YL-69 A0 line is usually steadier than this. */
      #define MOISTURE_FLOAT_SPREAD_FAIL 1400
      #endif

      /**
       * YL-69 A0: wet → low ADC, dry → high/near 4095. Stable line (low spread) = connected.
       */
      static bool moistureHealthOk(int avgAdc, int spread) {
        if (spread <= 60) {
          return true;
        }
        if (spread > MOISTURE_FLOAT_SPREAD_FAIL) {
          return false;
        }
        if (avgAdc > 400 && avgAdc < 3700 && spread > 900) {
          return false;
        }
        return true;
      }

      static void readMoistureAdcOnPin(int pin, int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        (void)analogRead(pin);
        delay(1);
        long sum = 0;
        int minV = 4095;
        int maxV = 0;
        for (int i = 0; i < MOISTURE_ADC_SAMPLES; i++) {
          const int v = analogRead(pin);
          sum += v;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
          delay(2);
        }
        avgOut = (int)(sum / MOISTURE_ADC_SAMPLES);
        spreadOut = maxV - minV;
        minOut = minV;
        maxOut = maxV;
      }

      /** Primary GPIO35; fall back to GPIO34 if wire was never moved from an older build. */
      static void readMoistureAdc(int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        readMoistureAdcOnPin(MOISTURE_PIN, avgOut, spreadOut, minOut, maxOut);
        if (moistureHealthOk(avgOut, spreadOut)) {
          return;
        }
        int avg34 = 0, sp34 = 0, min34 = 0, max34 = 0;
        readMoistureAdcOnPin(MOISTURE_PIN_ALT, avg34, sp34, min34, max34);
        if (moistureHealthOk(avg34, sp34)) {
          avgOut = avg34;
          spreadOut = sp34;
          minOut = min34;
          maxOut = max34;
        }
      }

      static bool ledPinOn(int pin) {
        const int v = digitalRead(pin);
        return LED_ON_IS_HIGH ? (v == HIGH) : (v == LOW);
      }

      /**
       * Detect whether ANY wire is physically attached to GPIO15 (independent of door state).
       * Uses the touch sensor to measure parasitic capacitance: a bare GPIO returns a high
       * count, a connected wire returns a noticeably lower count. We average a few samples to
       * reject spurious readings, then put the pin back in INPUT_PULLUP for digital reads.
       */
      static bool doorWireConnected() {
      #if DOOR_SENSOR_SKIP_TOUCH_CHECK
        pinMode(REED_PIN, INPUT_PULLUP);
        return true;
      #endif
        const int kSamples = 8;
        uint32_t sum = 0;
        uint16_t maxv = 0;
        uint16_t minv = 0xFFFF;
        for (int i = 0; i < kSamples; i++) {
          const uint16_t v = touchRead(REED_TOUCH_CHANNEL);
          sum += v;
          if (v > maxv) maxv = v;
          if (v < minv) minv = v;
          delay(2);
        }
        // Restore digital input mode: touchRead leaves the pin in touch mode internally.
        pinMode(REED_PIN, INPUT_PULLUP);

        // Drop the worst (likely noise spike) sample, then average.
        const uint16_t avg = (uint16_t)((sum - maxv) / (kSamples - 1));

        Serial.print("DOOR touch avg=");
        Serial.print(avg);
        Serial.print(" min=");
        Serial.print(minv);
        Serial.print(" max=");
        Serial.println(maxv);

        // Lower count = higher capacitance = wire present.
        return avg < DOOR_SENSOR_TOUCH_DETACHED_THRESHOLD;
      }

      /**
       * Final door health: must be physically wired (capacitive presence) AND electrically
       * stable (no jitter / floating-line chaos). Either failure ⇒ not_working in the app.
       */
      static bool doorSensorElectricalOk() {
        if (!doorWireConnected()) return false;

        int transitions = 0;
        int prev = digitalRead(REED_PIN);
        for (int i = 0; i < 63; i++) {
          delayMicroseconds(280);
          const int v = digitalRead(REED_PIN);
          if (v != prev) {
            transitions++;
            prev = v;
          }
        }
        return transitions <= DOOR_SENSOR_MAX_JITTER_TRANSITIONS;
      }

      /** RTDB/Laravel `components.door_sensor` — false when HAVE_DOOR_SENSOR is 0. */
      static bool doorSensorStatusForPayload() {
      #if !HAVE_DOOR_SENSOR
        return false;
      #else
        return doorSensorElectricalOk();
      #endif
      }

      /** Fault buzzer: ignore door when HAVE_DOOR_SENSOR is 0 so a floating GPIO15 never alarms. */
      static bool doorSensorOkForAlerts() {
      #if !HAVE_DOOR_SENSOR
        return true;
      #else
        return doorSensorElectricalOk();
      #endif
      }

      // Relays ACTIVE LOW: LOW = ON, HIGH = OFF
      bool relayOn(int pin) {
        const int v = digitalRead(pin);
        return RELAY_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
      }

      /** Real ESP32 self-check. Only returns true when this MCU is actually healthy.
       *  Used in place of the old hardcoded "working".
       *  Fails on: lost WiFi, low heap (heap leak / corruption), or recent crash reset.
       */
      static bool esp32SelfCheckOk() {
        if (WiFi.status() != WL_CONNECTED) return false;
        // WiFi + TLS + JSON buffers are heavy; 20k was overly strict on some boards (false "MCU fault").
        if (ESP.getFreeHeap() < 12 * 1024) return false;
        // Do not use esp_reset_reason() here — relay inrush often leaves PANIC (4) on boot while MCU is fine.
        return true;
      }

      static bool hardwareTestActive() {
        return gTestMode.length() > 0 && (long)(millis()) < (long)gTestModeUntilMs;
      }

      static bool sessionStatusIsRunning() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "running");
      }

      static bool sessionStatusIsActive() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "running" || s == "paused");
      }

      static bool sessionStatusIsPaused() {
        String s = gSessionStatus;
        s.toLowerCase();
        s.trim();
        return (s == "paused");
      }

      static float gLastGoodAirC = NAN;
      static unsigned long gLastGoodAirMs = 0;

      /** DHT can glitch; keep last good reading so heaters are not stuck OFF during a run. */
      static float airCToUseForHeater(bool dhtOk, float airC) {
        if (dhtOk && !isnan(airC)) {
          gLastGoodAirC = airC;
          gLastGoodAirMs = millis();
          return airC;
        }
        if (!isnan(gLastGoodAirC) && (millis() - gLastGoodAirMs) < 180000UL) {
          return gLastGoodAirC;
        }
        if (gSessionTargetC > 1.0f) {
          return gSessionTargetC - 5.0f;
        }
        return NAN;
      }

      static bool dryingSessionRunning() {
        return sessionStatusIsRunning();
      }

      static bool sensorsBadForBuzzer(bool dhtOk, bool moistureOk, bool doorOk) {
        return !(dhtOk && moistureOk && doorOk);
      }

      static bool dryingSessionActiveForBuzzer() {
        return sessionStatusIsRunning() && gFaultBuzzerArmed;
      }

      static bool tempFaultForBuzzer(bool dhtOk, float airC) {
        if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
          gBelowTargetSinceMs = 0;
          return false;
        }
        if (!dhtOk || isnan(airC) || gSessionTargetC <= 1.0f) {
          gBelowTargetSinceMs = 0;
          return false;
        }
        if (airC > (gSessionTargetC + TEMP_TARGET_MARGIN_C)) {
          return true;
        }
        if (airC < (gSessionTargetC - TEMP_TARGET_MARGIN_C)) {
          if (gBelowTargetSinceMs == 0) {
            gBelowTargetSinceMs = millis();
          }
          return (millis() - gBelowTargetSinceMs) >= TEMP_BELOW_TARGET_FAULT_MS;
        }
        gBelowTargetSinceMs = 0;
        return false;
      }

      static void buzzerForceSilent();
      static void buzzerHwStart();

      static void buzzerPhaseTimerCallback(void* /*arg*/) {
        if (!gBuzzerAlarmEngaged) return;
        if (gBuzzerInOnPhase) {
          gBuzzerInOnPhase = false;
          Serial.println("[buzzer] phase OFF 10s");
          buzzerForceSilent();
          if (gBuzzerPhaseTimer != nullptr) {
            esp_timer_start_once(
                gBuzzerPhaseTimer,
                (uint64_t)ALERT_BUZZ_SILENT_MS * 1000ULL);
          }
        } else {
          gBuzzerInOnPhase = true;
          Serial.println("[buzzer] phase ON 10s");
          buzzerHwStart();
          if (gBuzzerPhaseTimer != nullptr) {
            esp_timer_start_once(
                gBuzzerPhaseTimer,
                (uint64_t)ALERT_BUZZ_ON_MS * 1000ULL);
          }
        }
      }

      static void buzzerStopPhaseTimer() {
        if (gBuzzerPhaseTimer != nullptr) {
          esp_timer_stop(gBuzzerPhaseTimer);
        }
      }

      static void buzzerSchedulePhaseTimer(unsigned long periodMs) {
        if (gBuzzerPhaseTimer == nullptr) {
          esp_timer_create_args_t args = {};
          args.callback = &buzzerPhaseTimerCallback;
          args.name = "buzzer_10s";
          args.dispatch_method = ESP_TIMER_TASK;
          esp_timer_create(&args, &gBuzzerPhaseTimer);
        }
        esp_timer_stop(gBuzzerPhaseTimer);
        esp_timer_start_once(gBuzzerPhaseTimer, (uint64_t)periodMs * 1000ULL);
      }

      static void disengageBuzzerAlarm() {
        gBuzzerAlarmEngaged = false;
        gBuzzerInOnPhase = false;
        gBuzzerAllGoodSinceMs = 0;
        buzzerStopPhaseTimer();
        buzzerForceSilent();
      }

      static void engageBuzzerAlarm(unsigned long /*nowMs*/) {
        if (gBuzzerAlarmEngaged) return;
        gBuzzerAlarmEngaged = true;
        gBuzzerInOnPhase = true;
        gBuzzerAllGoodSinceMs = 0;
        Serial.println("[buzzer] engaged — 10s ON / 10s OFF (hardware timer)");
        buzzerHwStart();
        buzzerSchedulePhaseTimer(ALERT_BUZZ_ON_MS);
      }

      static void updateBuzzerFaultLatch(bool dhtOk, bool moistureOk, bool doorOk, float airC) {
        if (!sessionStatusIsActive() || !gFaultBuzzerArmed || !sessionStatusIsRunning()) {
          disengageBuzzerAlarm();
          gBelowTargetSinceMs = 0;
          return;
        }
        const bool faultNow =
            sensorsBadForBuzzer(dhtOk, moistureOk, doorOk) || tempFaultForBuzzer(dhtOk, airC);
        if (faultNow) {
          gBuzzerAllGoodSinceMs = 0;
          engageBuzzerAlarm(millis());
          return;
        }
        if (!gBuzzerAlarmEngaged) return;
        if (gBuzzerAllGoodSinceMs == 0) {
          gBuzzerAllGoodSinceMs = millis();
        }
        if ((millis() - gBuzzerAllGoodSinceMs) >= BUZZER_ALARM_DISENGAGE_MS) {
          Serial.println("[buzzer] disengaged — all OK 30s");
          disengageBuzzerAlarm();
        }
      }

      static void clearCloudTestCommand() {
        if (gAssignedId <= 0) return;
        (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_command", "null");
      }

      /** Hardware off — only at end of 10 s ON window or session end. */
      static void buzzerForceSilent() {
        if (gBuzzerHwPwmOn) {
          ledcWrite(BUZZER_PIN, 0);
          ledcDetach(BUZZER_PIN);
          gBuzzerHwPwmOn = false;
        } else {
          noTone(BUZZER_PIN);
        }
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, LOW);
        gBuzzerTonePlaying = false;
        gBuzzerPinHigh = false;
      }

      /** Passive piezo: LEDC PWM = continuous tone for the full 10 s ON phase. */
      static void buzzerHwStart() {
        if (gBuzzerHwPwmOn) return;
        noTone(BUZZER_PIN);
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, LOW);
        if (!ledcAttach(BUZZER_PIN, BUZZER_TONE_HZ, 8)) {
          Serial.println("[buzzer] ledcAttach failed — check GPIO27 piezo wiring");
          return;
        }
        ledcWrite(BUZZER_PIN, BUZZER_PWM_DUTY);
        gBuzzerHwPwmOn = true;
        gBuzzerTonePlaying = true;
        gBuzzerPinHigh = true;
      }

      /** Software toggle — hardware tests only. */
      static void buzzerTickSquareWave() {
        const uint32_t halfUs = 500000UL / (uint32_t)BUZZER_TONE_HZ;
        const uint32_t now = micros();
        if ((uint32_t)(now - gBuzzerLastToggleUs) < halfUs) return;
        gBuzzerLastToggleUs = now;
        gBuzzerPinLevel = !gBuzzerPinLevel;
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, gBuzzerPinLevel ? HIGH : LOW);
        gBuzzerTonePlaying = true;
        gBuzzerPinHigh = gBuzzerPinLevel;
      }

      static void buzzerAlarmBlockingSeconds(int sec) {
        if (sec <= 0) return;
        Serial.print("[buzzer] boot test ");
        Serial.print(sec);
        Serial.println(" s");
        buzzerHwStart();
        delay((unsigned long)sec * 1000UL);
        buzzerForceSilent();
      }

      static bool buzzerTestPatternOn(unsigned long nowMs) {
        if (!hardwareTestActive()) return false;
        if (gTestMode == "all") {
          const unsigned long t = nowMs % 1200UL;
          return (t < 180UL) || (t >= 400UL && t < 580UL);
        }
        if (gTestMode == "component") {
          String c = gTestComponent;
          c.toLowerCase();
          if (c == "buzzer") {
            return ((nowMs / 500UL) % 2UL) == 0UL;
          }
          return (nowMs % 2000UL) < 120UL;
        }
        return false;
      }

      /** ONLY call from loop() — never from sendHeartbeat (sensor re-reads caused 1 s gaps). */
      static void serviceBuzzer(bool dhtOk, bool moistureOk, bool doorOk, float airC) {
        const unsigned long now = millis();
        updateBuzzerFaultLatch(dhtOk, moistureOk, doorOk, airC);

        if (hardwareTestActive()) {
          disengageBuzzerAlarm();
          if (buzzerTestPatternOn(now)) {
            buzzerForceSilent();
            buzzerTickSquareWave();
          } else {
            buzzerForceSilent();
          }
          return;
        }

        if (!gBuzzerAlarmEngaged) {
          if (gBuzzerTonePlaying) buzzerForceSilent();
          return;
        }

        // Timer owns 10s/10s; re-sync HW if something silenced the piezo during HTTP.
        if (gBuzzerInOnPhase) {
          if (!gBuzzerHwPwmOn) buzzerHwStart();
        } else if (gBuzzerHwPwmOn || gBuzzerTonePlaying) {
          buzzerForceSilent();
        }
      }

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

      static void syncClockOnce() {
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        // Best-effort; don't block forever.
        for (int i = 0; i < 20; i++) {
          time_t now = time(nullptr);
          if (now > 1700000000) return; // ~2023+
          delay(150);
        }
      }

      static String isoNow() {
        time_t now = time(nullptr);
        struct tm t;
        gmtime_r(&now, &t);
        char buf[32];
        // ISO8601 UTC
        snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
                t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
                t.tm_hour, t.tm_min, t.tm_sec);
        return String(buf);
      }

      /** Parse `2026-05-16T12:34:56Z` (UTC-ish) to epoch seconds; 0 if invalid. */
      static time_t parseIso8601Epoch(const String& iso) {
        if (iso.length() < 19) return 0;
        struct tm t = {};
        int y = 0, M = 0, d = 0, h = 0, m = 0, s = 0;
        if (sscanf(iso.c_str(), "%d-%d-%dT%d:%d:%d", &y, &M, &d, &h, &m, &s) < 6) {
          return 0;
        }
        t.tm_year = y - 1900;
        t.tm_mon = M - 1;
        t.tm_mday = d;
        t.tm_hour = h;
        t.tm_min = m;
        t.tm_sec = s;
        return mktime(&t);
      }

      static String rtdbGetText(const String& pathNoJsonSuffix) {
        if (WiFi.status() != WL_CONNECTED) return String();
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.setTimeout(6000);
        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";
        http.begin(client, url);
        const int code = http.GET();
        String body;
        if (code >= 200 && code < 300) body = http.getString();
        http.end();
        return body;
      }

      /** Initialize MAC-based identity; load any persisted assignment from NVS. */
      static void initIdentity() {
        gDeviceMac = WiFi.macAddress();
        gDeviceMacSafe = gDeviceMac;
        gDeviceMacSafe.replace(":", "");
        // Friendly default name: "Fish Dryer ABCD" using last 4 hex of MAC.
        const String tail = gDeviceMacSafe.substring(gDeviceMacSafe.length() - 4);
        gDeviceName = String("Fish Dryer ") + tail;

        gPrefs.begin("fdmcu", false);
        gAssignedId = gPrefs.getInt("mcid", 0);
        // Optional persisted display name, set by user via app -> assignments/{MAC}/name.
        const String persistedName = gPrefs.getString("name", "");
        if (persistedName.length() > 0) gDeviceName = persistedName;
        gPrefs.end();
      }

      static void persistAssignment(int id, const String& name) {
        gPrefs.begin("fdmcu", false);
        gPrefs.putInt("mcid", id);
        if (name.length() > 0) gPrefs.putString("name", name);
        gPrefs.end();
      }

      /** Read assignments/{macSafe} from RTDB and adopt any new ID/name. Returns true if updated. */
      static bool refreshAssignmentFromCloud() {
        const String body = rtdbGetText(String("assignments/") + gDeviceMacSafe);
        if (body.length() == 0 || body == "null") return false;

        // Cheap JSON pick — avoids pulling ArduinoJson for two fields.
        int newId = gAssignedId;
        String newName = gDeviceName;
        const int idKey = body.indexOf("\"microcontroller_id\"");
        if (idKey >= 0) {
          int colon = body.indexOf(':', idKey);
          if (colon > 0) {
            int end = colon + 1;
            while (end < (int)body.length() && (body[end] == ' ' || body[end] == '\t')) end++;
            int numStart = end;
            while (end < (int)body.length() && (isdigit(body[end]) || body[end] == '-')) end++;
            if (end > numStart) newId = body.substring(numStart, end).toInt();
          }
        }
        // Plain numeric body (e.g. "5") is also accepted.
        if (idKey < 0) {
          String trimmed = body;
          trimmed.trim();
          if (trimmed.length() > 0 && (isdigit(trimmed[0]) || trimmed[0] == '-')) {
            newId = trimmed.toInt();
          }
        }
        const int nameKey = body.indexOf("\"name\"");
        if (nameKey >= 0) {
          int colon = body.indexOf(':', nameKey);
          int q1 = body.indexOf('"', colon + 1);
          int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
          if (q1 >= 0 && q2 > q1) newName = body.substring(q1 + 1, q2);
        }

        const bool changed = (newId != gAssignedId) || (newName.length() > 0 && newName != gDeviceName);
        if (changed) {
          if (newId != gAssignedId) {
            Serial.printf("[assignment] id changed %d -> %d\n", gAssignedId, newId);
          }
          gAssignedId = newId;
          if (newName.length() > 0) gDeviceName = newName;
          persistAssignment(gAssignedId, gDeviceName);
        }
        return changed;
      }

      static int parseJsonIntAfterKey(const String& body, const char* key, int defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        const int start = i;
        while (i < (int)body.length() && isdigit((unsigned char)body[i])) i++;
        if (i == start) return defV;
        return body.substring(start, i).toInt();
      }

      static float parseJsonFloatAfterKey(const String& body, const char* key, float defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        const int start = i;
        while (i < (int)body.length() &&
               (isdigit((unsigned char)body[i]) || body[i] == '.' || body[i] == '-' ||
                body[i] == 'e' || body[i] == 'E' || body[i] == '+')) {
          i++;
        }
        if (i == start) return defV;
        return body.substring(start, i).toFloat();
      }

      /** Heater bang‑bang vs air temp — only while session is `running` (paused = heaters off). */
      static void applyHeaterControlForSession(bool dhtOk, float airC) {
        if (hardwareTestActive()) {
          return;
        }
        if (!sessionStatusIsRunning() || gAssignedId <= 0) {
          driveRelay(RELAY_HEATER1, false);
          driveRelay(RELAY_HEATER2, false);
          return;
        }
        if (gSessionTargetC <= 1.0f) {
          driveRelay(RELAY_HEATER1, false);
          driveRelay(RELAY_HEATER2, false);
          return;
        }
        const float airUse = airCToUseForHeater(dhtOk, airC);
        if (isnan(airUse)) {
          driveRelay(RELAY_HEATER1, false);
          driveRelay(RELAY_HEATER2, false);
          return;
        }
        const bool heatOn = airUse < (gSessionTargetC - 0.5f);
        driveRelay(RELAY_HEATER1, heatOn);
        driveRelay(RELAY_HEATER2, heatOn);
      }

      /**
       * Single fan relay + three “speeds”: duty within a 30s window (level 1≈33%, 2≈67%, 3=100%).
       * Call every `loop()` so it updates between heartbeats.
       */
      /** Fan ON for entire running or paused session (steady — no PWM flicker). */
      static void applyFanRelayModulationForSession() {
        if (hardwareTestActive()) {
          return;
        }
        if (!sessionStatusIsActive() || gAssignedId <= 0) {
          driveRelay(RELAY_FAN, false);
          return;
        }
        driveRelay(RELAY_FAN, true);
      }

      /** Fan duty for hardware test (level 1≈33%, 2≈67%, 3=continuous). */
      static void applyFanRelayForTestLevel(int lvl) {
        if (lvl < 1) lvl = 1;
        if (lvl > 3) lvl = 3;
        if (lvl >= 3) {
          driveRelay(RELAY_FAN, true);
          return;
        }
        const unsigned long T = 30000UL;
        const unsigned long phase = millis() % T;
        const unsigned long onMs = (T * (unsigned long)lvl) / 3UL;
        driveRelay(RELAY_FAN, phase < onMs);
      }

      static void applyTestActuators() {
        const bool blink = (gTestMode == "component");
        const bool onPhase = !blink || ((millis() / 400UL) % 2UL) == 0UL;

        driveRelay(RELAY_FAN, false);
        driveRelay(RELAY_HEATER1, false);
        driveRelay(RELAY_HEATER2, false);

        if (gTestMode == "all") {
          applyFanRelayForTestLevel(gTestFanLevel);
          driveRelay(RELAY_HEATER1, true);
          driveRelay(RELAY_HEATER2, true);
          return;
        }

        if (gTestMode == "component") {
          String c = gTestComponent;
          c.toLowerCase();
          if (c == "heater_1") {
            driveRelay(RELAY_HEATER1, onPhase);
          } else if (c == "heater_2") {
            driveRelay(RELAY_HEATER2, onPhase);
          } else if (c.indexOf("fan") >= 0 || c == "ventilation_fan") {
            applyFanRelayForTestLevel(3);
          } else {
            applyFanRelayForTestLevel(gTestFanLevel);
            driveRelay(RELAY_HEATER1, onPhase);
            driveRelay(RELAY_HEATER2, onPhase);
          }
        }
      }

      /** Drive the 3 status LEDs from a session-state string. */
      static void applyLedsForSession(const String& sessionStatus) {
        String s = sessionStatus;
        s.toLowerCase();
        s.trim();
        const bool running = (s == "running");
        const bool paused  = (s == "paused");
        const bool redOn   = !running && !paused;
        // Anything else (stopped, idle, "", null) → RED on.
        driveLed(LED_GREEN,  running);
        driveLed(LED_YELLOW, paused);
        driveLed(LED_RED,    redOn);

        static String lastLedSession = "";
        if (s != lastLedSession) {
          lastLedSession = s;
          Serial.print("[led] session=");
          Serial.print(s.length() ? s.c_str() : "stopped");
          Serial.print(" G=");
          Serial.print(running ? 1 : 0);
          Serial.print(" Y=");
          Serial.print(paused ? 1 : 0);
          Serial.print(" R=");
          Serial.print(redOn ? 1 : 0);
          Serial.print(" LED_ON_IS_HIGH=");
          Serial.println(LED_ON_IS_HIGH ? 1 : 0);
        }
      }

      static void forceIdleSessionState() {
        gSessionStatus = "stopped";
        gFaultBuzzerArmed = false;
        gDrySessionLatched = false;
        gBelowTargetSinceMs = 0;
        disengageBuzzerAlarm();
        driveRelay(RELAY_FAN, false);
        driveRelay(RELAY_HEATER1, false);
        driveRelay(RELAY_HEATER2, false);
        applyLedsForSession("stopped");
      }

      static void logActuatorState(const char* why) {
        Serial.print("[actuator] ");
        Serial.print(why);
        Serial.print(" session=");
        Serial.print(gSessionStatus);
        Serial.print(" armed=");
        Serial.print(gFaultBuzzerArmed ? 1 : 0);
        Serial.print(" targetC=");
        Serial.print(gSessionTargetC, 1);
        Serial.print(" fan=");
        Serial.print(relayOn(RELAY_FAN) ? 1 : 0);
        Serial.print(" h1=");
        Serial.print(relayOn(RELAY_HEATER1) ? 1 : 0);
        Serial.print(" h2=");
        Serial.print(relayOn(RELAY_HEATER2) ? 1 : 0);
        Serial.print(" RELAY_ACTIVE_LOW=");
        Serial.println(RELAY_ACTIVE_LOW ? 1 : 0);
      }

      /** Fan + heaters + LEDs — always before heartbeat so RTDB `fan_on` is correct. */
      static void applySessionActuators(bool dhtOk, float airC) {
        if (hardwareTestActive()) {
          return;
        }
        applyFanRelayModulationForSession();
        applyHeaterControlForSession(dhtOk, airC);
        applyLedsForSession(gSessionStatus);
      }

      /**
       * Pull `machines/{gAssignedId}/session` from RTDB (status, fan_speed, target_temperature).
       * Mobile writes the whole object on Start/Pause/Stop.
       */
      static void refreshSessionFromCloud() {
        // No numeric machine id from the app yet — there is no cloud drying session to follow.
        // Keep local state idle so the RED "no session" LED stays on (do not early-return silently).
        if (gAssignedId <= 0) {
          gSessionStatus = "stopped";
          gFaultBuzzerArmed = false;
          applyLedsForSession(gSessionStatus);
          return;
        }

        const String body = rtdbGetText(String("machines/") + String(gAssignedId) + "/session");
        if (body.length() == 0 || body == "null") {
          forceIdleSessionState();
          return;
        }

        String parsed = "stopped";
        String trimmed = body;
        trimmed.trim();
        if (trimmed.length() > 0 && trimmed != "null") {
          const int sq = trimmed.indexOf("\"status\"");
          if (sq >= 0) {
            const int colon = trimmed.indexOf(':', sq);
            const int q1 = trimmed.indexOf('"', colon + 1);
            const int q2 = q1 >= 0 ? trimmed.indexOf('"', q1 + 1) : -1;
            if (q1 >= 0 && q2 > q1) {
              parsed = trimmed.substring(q1 + 1, q2);
            }
          } else if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length() >= 2) {
            parsed = trimmed.substring(1, trimmed.length() - 1);
          } else if (trimmed.indexOf('{') < 0) {
            parsed = trimmed;
          }
        }

        const int fs = parseJsonIntAfterKey(body, "fan_speed", gFanSpeedLevel);
        gFanSpeedLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);

        parsed.toLowerCase();
        parsed.trim();
        if (parsed.length() == 0) {
          parsed = "stopped";
        }

        const float tt = parseJsonFloatAfterKey(body, "target_temperature", gSessionTargetC);
        if (tt > 1.0f && tt < 120.0f) {
          gSessionTargetC = tt;
        } else if (
            (parsed == "running" || parsed == "paused") && gSessionTargetC <= 1.0f) {
          gSessionTargetC = 60.0f;
        }

        const bool sessionLive = (parsed == "running" || parsed == "paused");
        gFaultBuzzerArmed =
            parseJsonBoolAfterKey(body, "fault_buzzer_armed", sessionLive);

        if (parsed == "stopped") {
          forceIdleSessionState();
          return;
        }

        const bool statusChanged = (parsed != gSessionStatus);
        gSessionStatus = parsed;
        if (statusChanged) {
          Serial.print("[session] -> ");
          Serial.print(parsed);
          Serial.print(" | fan_lvl=");
          Serial.print(gFanSpeedLevel);
          Serial.print(" targetC=");
          Serial.print(gSessionTargetC, 1);
          Serial.print(" buzzer_armed=");
          Serial.println(gFaultBuzzerArmed ? 1 : 0);
          logActuatorState("session-change");
        }
        if (!hardwareTestActive()) {
          applyLedsForSession(gSessionStatus);
        }
      }

      static bool parseJsonBoolAfterKey(const String& body, const char* key, bool defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        int i = colon + 1;
        while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
        if (body.startsWith("true", i)) return true;
        if (body.startsWith("false", i)) return false;
        return defV;
      }

      static String parseJsonStringAfterKey(const String& body, const char* key, const String& defV) {
        const String k = String("\"") + key + "\"";
        const int p = body.indexOf(k);
        if (p < 0) return defV;
        const int colon = body.indexOf(':', p);
        if (colon < 0) return defV;
        const int q1 = body.indexOf('"', colon + 1);
        const int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
        if (q1 < 0 || q2 <= q1) return defV;
        return body.substring(q1 + 1, q2);
      }

      static void endHardwareTest() {
        gTestMode = "";
        gTestComponent = "";
        gTestModeUntilMs = 0;
        gTestFanLevel = 3;
        buzzerForceSilent();
        driveRelay(RELAY_FAN, false);
        driveRelay(RELAY_HEATER1, false);
        driveRelay(RELAY_HEATER2, false);
        applyLedsForSession(gSessionStatus);
        clearCloudTestCommand();
      }

      static void tickHardwareTestOutputs() {
        const unsigned long now = millis();
        if (!hardwareTestActive()) {
          if (gTestMode.length() > 0) endHardwareTest();
          return;
        }

        // Drying session owns LEDs + fan/heater — never cycle colours during Start/Pause/Run.
        if (sessionStatusIsActive()) {
          endHardwareTest();
          return;
        }

        if (gTestMode == "all") {
          applyLedsForSession(gSessionStatus);
          applyTestActuators();
          return;
        }

        if (gTestMode == "component") {
          String c = gTestComponent;
          c.toLowerCase();
          const bool testsLed =
            (c == "esp32" || c == "led_1" || c == "led_2" || c == "led_3" ||
             c == "led_drying" || c == "led_pause" || c == "led_stop" || c == "buzzer");

          if (testsLed) {
            const bool blink = ((now / 350UL) % 2UL) == 0UL;
            driveLed(LED_GREEN,  false);
            driveLed(LED_YELLOW, false);
            driveLed(LED_RED,    false);
            if (c == "esp32" || c == "led_1" || c == "led_drying") {
              driveLed(LED_GREEN, blink);
            } else if (c == "dht22" || c == "led_2" || c == "led_pause") {
              driveLed(LED_YELLOW, blink);
            } else if (c == "door_sensor" || c == "moisture_sensor" || c == "led_3" || c == "led_stop") {
              driveLed(LED_RED, blink);
            } else if (c == "buzzer") {
              driveLed(LED_GREEN, blink);
              driveLed(LED_YELLOW, blink);
              driveLed(LED_RED, blink);
            } else {
              driveLed(LED_GREEN, blink);
            }
          } else {
            applyLedsForSession(gSessionStatus);
          }

          applyTestActuators();
        }
      }

      static void refreshTestCommandFromCloud() {
        if (gAssignedId <= 0) return;
        if (sessionStatusIsActive()) {
          if (hardwareTestActive()) endHardwareTest();
          return;
        }
        const String body = rtdbGetText(String("machines/") + String(gAssignedId) + "/test_command");
        if (body.length() == 0 || body == "null") {
          if (hardwareTestActive()) endHardwareTest();
          return;
        }

        const String mode = parseJsonStringAfterKey(body, "mode", "");
        const String component = parseJsonStringAfterKey(body, "component", "");
        const String reqId = parseJsonStringAfterKey(body, "request_id", "");
        int durationMs = parseJsonIntAfterKey(body, "duration_ms", 10000);
        if (durationMs < 2000) durationMs = 2000;
        if ((unsigned long)durationMs > HARDWARE_TEST_MAX_MS) {
          durationMs = (int)HARDWARE_TEST_MAX_MS;
        }

        if (mode != "all" && mode != "component") {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
          }
          return;
        }
        if (reqId.length() == 0) {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
          }
          return;
        }

        // CRITICAL: stale test_command in RTDB used to re-start Test All forever → endless buzzer.
        if (reqId == gLastTestRequestId) {
          if (!hardwareTestActive()) {
            clearCloudTestCommand();
            applyLedsForSession(gSessionStatus);
          }
          return;
        }

        gLastTestRequestId = reqId;
        gTestMode = mode;
        gTestComponent = component;
        gTestModeUntilMs = millis() + (unsigned long)durationMs;
        int fs = parseJsonIntAfterKey(body, "fan_speed", 3);
        gTestFanLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);
        Serial.print("[test] ");
        Serial.print(mode);
        Serial.print(" component=");
        Serial.print(component);
        Serial.print(" ms=");
        Serial.println(durationMs);
      }

      static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody) {
        if (WiFi.status() != WL_CONNECTED) return false;
        HTTPClient http;
        http.setTimeout(8000);

        // Firebase RTDB requires HTTPS. For quick test-mode validation, we skip cert validation.
        // (Do NOT ship like this; use certificate pinning or a proper client.)
        WiFiClientSecure client;
        client.setInsecure();

        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";

        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");
        int code = http.PUT(jsonBody);
        String resp = http.getString();
        http.end();

        Serial.print("RTDB PUT ");
        Serial.print(code);
        Serial.print(" ");
        Serial.println(resp);

        return code >= 200 && code < 300;
      }

      static unsigned long gLastLaravelFailLogMs = 0;
      static unsigned long gLaravelPostBackoffUntilMs = 0;

      bool postJsonWithRetries(const String& payload, int retries = 3) {
        const unsigned long nowMs = millis();
        if (gLaravelPostBackoffUntilMs != 0 && (long)(nowMs - gLaravelPostBackoffUntilMs) < 0) {
          return false;
        }

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
          WiFiClient client;
          http.setTimeout(12000);
          http.setConnectTimeout(8000);
          if (!http.begin(client, API_URL)) {
            Serial.println("Heartbeat: http.begin failed — check API_URL");
            delay(500);
            continue;
          }
          http.addHeader("Content-Type", "application/json");

          Serial.print("Posting heartbeat to ");
          Serial.print(API_URL);
          Serial.print(" (attempt ");
          Serial.print(attempt);
          Serial.println(")...");

          int code = http.POST(payload);
          String resp = http.getString();

          Serial.print("Heartbeat HTTP: ");
          Serial.println(code);
          if (code < 0) {
            if (gLastLaravelFailLogMs == 0 || (nowMs - gLastLaravelFailLogMs) > 60000UL) {
              gLastLaravelFailLogMs = nowMs;
              Serial.print("Heartbeat error: ");
              Serial.println(http.errorToString(code));
              Serial.println("Laravel unreachable — fix API_URL + artisan serve. RTDB/mobile still OK.");
            }
          }
          Serial.print("Heartbeat Resp: ");
          Serial.println(resp);

          http.end();

          if (code >= 200 && code < 300) {
            gLaravelPostBackoffUntilMs = 0;
            gLastLaravelFailLogMs = 0;
            return true;
          }

          delay(500);
        }
        gLaravelPostBackoffUntilMs = millis() + 45000UL;
        return false;
      }

      void sendHeartbeat(bool /*dhtOk*/, bool /*moistureOk*/, bool /*doorOk*/) {
        // Pull the latest cloud assignment first so a freshly-saved board adopts its
        // numeric ID within one heartbeat (no reflash, no reboot).
        (void)refreshAssignmentFromCloud();

        refreshSessionFromCloud();
        refreshTestCommandFromCloud();

        const bool esp32Ok = esp32SelfCheckOk();
        // `components.esp32` in JSON/RTDB = "MCU online" (Wi‑Fi path works). Heap/reset
        // self-check still drives Serial + alert buzzer via `esp32Ok`.
        const bool esp32UiOnline = (WiFi.status() == WL_CONNECTED);
        const bool dhtOkReport = pollDhtIfDue();
        const float t = cachedDhtT;
        const float h = cachedDhtH;

        int moistureRaw = 0;
        int spread = 0;
        int moistureMin = 0;
        int moistureMax = 0;
        readMoistureAdc(moistureRaw, spread, moistureMin, moistureMax);
        const bool moistureOkInstant = moistureHealthOk(moistureRaw, spread);
        const bool moistureOkReport = moistureOkInstant;

        const bool doorOkReport = doorSensorStatusForPayload();
        const bool doorOkAlert = doorSensorOkForAlerts();

        if (moistureOkInstant) {
          updateMoistureBounds(moistureRaw);
        }
        const int moisturePct = moisturePercentFromAdc(moistureRaw);
        const int doorRaw = digitalRead(REED_PIN);
        const bool doorOpen = (doorRaw == LOW);

        // Calibration health: needs both initialized bounds and enough span to map ADC → %.
        // Span < 500 means we've only seen narrow values, so percentages will be wildly biased
        // until the user wets/dries the probe to widen the learned range.
        const int moistureSpanLearned = (MOISTURE_DRY_ADC > MOISTURE_WET_ADC)
            ? (MOISTURE_DRY_ADC - MOISTURE_WET_ADC)
            : (MOISTURE_WET_ADC - MOISTURE_DRY_ADC);
        const bool moistureCalibrated =
            moistureOkReport &&
            (moistureSpanLearned >= MOISTURE_LEARNED_SPAN_MIN ||
             moistureBoundsInitialized);

        Serial.print("MOISTURE raw=");
        Serial.print(moistureRaw);
        Serial.print(" min=");
        Serial.print(moistureMin);
        Serial.print(" max=");
        Serial.print(moistureMax);
        Serial.print(" spread=");
        Serial.print(spread);
        Serial.print(" snap35=");
        Serial.print(analogRead(MOISTURE_PIN));
        Serial.print(" snap34=");
        Serial.print(analogRead(MOISTURE_PIN_ALT));
        Serial.print(" pct=");
        Serial.print(moisturePct);
        Serial.print(" status=");
        Serial.print(moistureOkReport ? "OK" : "FAIL");
        Serial.print(" | DHT ");
        Serial.print(dhtOkReport ? "OK" : "FAIL");
        Serial.print(" | DOOR ");
        #if HAVE_DOOR_SENSOR
        Serial.print(doorOkReport ? "OK" : "FAIL");
        #else
        Serial.print("off(not installed)");
        #endif
        Serial.print(" | ESP32 ");
        Serial.print(esp32Ok ? "OK" : "FAIL");
        Serial.print(" heap=");
        Serial.println((unsigned int)ESP.getFreeHeap());

        if (!dhtOkReport || !moistureOkReport || (HAVE_DOOR_SENSOR && !doorOkReport) || !esp32Ok) {
          Serial.print("[diag] reset_reason=");
          Serial.print((int)esp_reset_reason());
          Serial.print(" | HAVE_DOOR_SENSOR=");
          Serial.print(HAVE_DOOR_SENSOR ? 1 : 0);
          if (HAVE_DOOR_SENSOR && !doorOkReport) {
            Serial.print(" | door: check GPIO15 reed to GND when closed");
          }
          Serial.println();
        }

        applySessionActuators(dhtOkReport, t);
        serviceBuzzer(dhtOkReport, moistureOkReport, doorOkAlert, t);

        String payload;
        payload.reserve(900);

        payload += "{";
        payload += "\"microcontroller_id\":";
        payload += gAssignedId;
        // Always include MAC + name so Laravel can resolve unassigned boards by hardware identity.
        payload += ",\"device_id\":\""; payload += gDeviceName; payload += "\"";
        payload += ",\"mac\":\""; payload += gDeviceMac; payload += "\"";

        // Only sensors with real signals are reported. Outputs (LEDs, heaters, fans, buzzer)
        // have no feedback line, so the app intentionally does not list them.
        payload += ",\"components\":{";

        payload += "\"esp32\":\""; payload += statusWord(esp32UiOnline); payload += "\",";
        payload += "\"dht22\":\""; payload += statusWord(dhtOkReport); payload += "\",";
        payload += "\"moisture_sensor\":\""; payload += statusWord(moistureOkReport); payload += "\",";
        payload += "\"door_sensor\":\""; payload += statusWord(doorOkReport); payload += "\"";

        payload += "}";
        payload += ",\"readings\":{";
        {
          bool laravelReadingsFirst = true;
          auto laravelReadingsComma = [&]() {
            if (!laravelReadingsFirst) payload += ",";
            laravelReadingsFirst = false;
          };
          if (dhtOkReport && !isnan(t)) {
            laravelReadingsComma();
            payload += "\"temperature\":";
            payload += String(t, 1);
          }
          if (dhtOkReport && !isnan(h)) {
            laravelReadingsComma();
            payload += "\"humidity\":";
            payload += String(h, 1);
          }
          if (moistureOkReport) {
            laravelReadingsComma();
            payload += "\"moisture_percent\":";
            payload += moisturePct;
            laravelReadingsComma();
            payload += "\"moisture\":";
            payload += moisturePct;
          }
        }
        payload += "}";
        payload += "}";

        #if SEND_TO_LARAVEL
          postJsonWithRetries(payload, 3);
        #endif

        // Push snapshot to Firebase RTDB (mobile subscribes; no refresh needed).
        // Only attach updated_at when wall clock is real; otherwise mobile uses snapshot-arrival
        // time as "fresh" (writing 1970-01-01 makes the app flip working → not_working).
        const time_t epoch = time(nullptr);
        const bool clockSynced = epoch > 1700000000;
        String root;
        root.reserve(800);
        root += "{";
        root += "\"microcontroller_id\":"; root += gAssignedId;
        // Per-board identity: name + MAC so the app can tell physical boards apart even if you reuse IDs.
        root += ",\"name\":\""; root += gDeviceName; root += "\"";
        root += ",\"device_id\":\""; root += gDeviceName; root += "\"";
        root += ",\"mac\":\""; root += gDeviceMac; root += "\"";
        // Mobile needs a parseable heartbeat time for "live" sensors. Without NTP, ISO would be
        // 1970 and look stale; Firebase expands {".sv":"timestamp"} to epoch ms on write.
        if (clockSynced) {
          root += ",\"updated_at\":\"";
          root += isoNow();
          root += "\"";
        } else {
          root += ",\"updated_at\":{\".sv\":\"timestamp\"}";
        }

        root += ",\"components\":{";
        root += "\"esp32\":\""; root += statusWord(esp32UiOnline); root += "\",";
        root += "\"door_sensor\":\""; root += statusWord(doorOkReport); root += "\",";
        root += "\"moisture_sensor\":\""; root += statusWord(moistureOkReport); root += "\",";
        root += "\"dht22\":\""; root += statusWord(dhtOkReport); root += "\"";
        root += "}";

        // Only publish readings for sensors that passed health checks — floating ADC / unplugged
        // probes still produce numbers and must not look like valid telemetry in the app.
        root += ",\"readings\":{";
        {
          bool readingsFirst = true;
          auto readingsComma = [&]() {
            if (!readingsFirst) root += ",";
            readingsFirst = false;
          };
          if (dhtOkReport && !isnan(t)) {
            readingsComma();
            root += "\"temperature\":";
            root += String(t, 1);
          }
          if (dhtOkReport && !isnan(h)) {
            readingsComma();
            root += "\"humidity\":";
            root += String(h, 1);
          }
          if (moistureOkReport) {
            readingsComma();
            root += "\"moisture\":";
            root += moisturePct;
            root += ",\"moisture_percent\":";
            root += moisturePct;
            root += ",\"moisture_raw\":";
            root += moistureRaw;
            root += ",\"moisture_dry_adc\":";
            root += MOISTURE_DRY_ADC;
            root += ",\"moisture_wet_adc\":";
            root += MOISTURE_WET_ADC;
            root += ",\"moisture_span\":";
            root += moistureSpanLearned;
            root += ",\"moisture_calibrated\":";
            root += moistureCalibrated ? "true" : "false";
          }
          if (doorOkReport) {
            readingsComma();
            root += "\"door\":\"";
            root += (doorOpen ? "open" : "closed");
            root += "\"";
          }
          readingsComma();
          root += "\"outputs\":{";
        }
        root += "\"fan_on\":"; root += relayOn(RELAY_FAN) ? "true" : "false";
        root += ",\"heater1_on\":"; root += relayOn(RELAY_HEATER1) ? "true" : "false";
        root += ",\"heater2_on\":"; root += relayOn(RELAY_HEATER2) ? "true" : "false";
        root += ",\"led1_on\":"; root += ledPinOn(LED1) ? "true" : "false";
        root += ",\"led2_on\":"; root += ledPinOn(LED2) ? "true" : "false";
        root += ",\"led3_on\":"; root += ledPinOn(LED3) ? "true" : "false";
        root += ",\"buzzer_on\":"; root += gBuzzerTonePlaying ? "true" : "false";
        root += "}";
        root += "}";
        root += "}";

        // Only publish to machines/{id}/... once an ID has been assigned by the user
        // from the mobile app. Otherwise the board just advertises in discovery/.
        if (gAssignedId > 0) {
          (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/hardware_status", root);
        }

        // Discovery is only for *unassigned* boards (mobile "Detect" before claiming).
        // Once gAssignedId > 0, all live telemetry belongs under machines/{id}/hardware_status only.
        if (gAssignedId <= 0) {
          String adv;
          adv.reserve(360);
          adv += "{";
          adv += "\"microcontroller_id\":"; adv += gAssignedId;
          adv += ",\"name\":\""; adv += gDeviceName; adv += "\"";
          adv += ",\"device_id\":\""; adv += gDeviceName; adv += "\"";
          adv += ",\"mac\":\""; adv += gDeviceMac; adv += "\"";
          adv += ",\"ip\":\""; adv += WiFi.localIP().toString(); adv += "\"";
          adv += ",\"rssi\":"; adv += WiFi.RSSI();
          adv += ",\"assigned\":false";
          if (clockSynced) {
            adv += ",\"updated_at\":\""; adv += isoNow(); adv += "\"";
          } else {
            adv += ",\"updated_at\":{\".sv\":\"timestamp\"}";
          }
          adv += "}";
          (void)rtdbPutJson(String("discovery/") + gDeviceMacSafe, adv);
        }
      }

      static void applySafeOutputDefaults() {
      #if START_WITH_OUTPUTS_ENERGIZED
        driveRelay(RELAY_FAN, true);
        driveRelay(RELAY_HEATER1, true);
        driveRelay(RELAY_HEATER2, true);
      #else
        driveRelay(RELAY_FAN, false);
        driveRelay(RELAY_HEATER1, false);
        driveRelay(RELAY_HEATER2, false);
      #endif
        // LEDs are session indicators (RED=stopped, YELLOW=paused, GREEN=running).
        // Default at boot = no session yet → RED on, others off. The next heartbeat
        // syncs to whatever session state the app/Laravel has set in Firebase.
        applyLedsForSession("stopped");
        buzzerForceSilent();
      }

      static void driveAllActuators(bool on) {
        driveLed(LED1, on);
        driveLed(LED2, on);
        driveLed(LED3, on);
        driveRelay(RELAY_FAN, on);
        driveRelay(RELAY_HEATER1, on);
        driveRelay(RELAY_HEATER2, on);
        if (!on) buzzerForceSilent();
      }

      #if LED_BOOT_SWEEP
      /** One-time boot proof: each colour lights in order, then idle RED. */
      static void runBootLedSweep() {
        Serial.println("[led] boot sweep (GPIO32=G, 33=Y, 13=R)");
        driveLed(LED_GREEN,  true);
        driveLed(LED_YELLOW, false);
        driveLed(LED_RED,    false);
        delay(450);
        driveLed(LED_GREEN,  false);
        driveLed(LED_YELLOW, true);
        driveLed(LED_RED,    false);
        delay(450);
        driveLed(LED_GREEN,  false);
        driveLed(LED_YELLOW, false);
        driveLed(LED_RED,    true);
        delay(450);
        applyLedsForSession(gSessionStatus.length() ? gSessionStatus : String("stopped"));
      }
      #endif

      static void pumpDelayMs(unsigned long ms) {
        const unsigned long start = millis();
        while (millis() - start < ms) {
          delay(50);
          yield();
        }
      }

      #if WIRING_CHECK_AT_BOOT
      static void runBootWiringCheck() {
        Serial.println();
        Serial.println("========== WIRING CHECK ==========");
        Serial.println("LEDs + fan + heater relays ON. Buzzer chirps. HOLDING...");
        driveAllActuators(true);

        buzzerHwStart();
        delay(220);
        buzzerForceSilent();
        delay(120);
        buzzerHwStart();
        delay(220);
        buzzerForceSilent();

        pumpDelayMs(WIRING_CHECK_HOLD_MS);

      #if START_WITH_OUTPUTS_ENERGIZED
        Serial.println("Hold finished — outputs stay ON (START_WITH_OUTPUTS_ENERGIZED=1).");
      #else
        Serial.println("Hold finished — turning outputs OFF (safe idle).");
        driveAllActuators(false);
        applyLedsForSession("stopped");
      #endif
        Serial.println("==================================");
      }
      #endif

      #if ENABLE_POWER_ON_SELFTEST
      static void applyBenchSelfTestOutputs() {
        driveLed(LED1, true);
        driveLed(LED2, true);
        driveLed(LED3, true);

        driveRelay(RELAY_FAN, true);
        driveRelay(RELAY_HEATER1, true);
        driveRelay(RELAY_HEATER2, true);

        buzzerHwStart();
        delay(120);
        buzzerForceSilent();
      }
      #endif

      static int gMoistureAvgCached = 0;
      static int gMoistureSpreadCached = 0;
      static unsigned long gLastMoistureSampleMs = 0;

      static void readSensorsOnce(bool& dhtOk, bool& moistureOk, bool& doorOk) {
        dhtOk = pollDhtIfDue();

        if (millis() - gLastMoistureSampleMs >= 800UL) {
          gLastMoistureSampleMs = millis();
          int minV = 0;
          int maxV = 0;
          readMoistureAdc(gMoistureAvgCached, gMoistureSpreadCached, minV, maxV);
        }
        moistureOk = moistureHealthOk(gMoistureAvgCached, gMoistureSpreadCached);

        doorOk = doorSensorStatusForPayload();
      }

      void setup() {
        Serial.begin(115200);
        delay(500);

        Serial.println();
        Serial.println("##############################################");
        Serial.println("# Fish Dryer ESP32 — runtime-assigned identity");
        Serial.println("# (no MICROCONTROLLER_ID hardcoded in source)");
        Serial.print("# BUILD: ");
        Serial.println(FIRMWARE_BUILD_TAG);
        Serial.println("##############################################");
        Serial.printf("Reset reason: %d\n", (int)esp_reset_reason());

        pinMode(LED1, OUTPUT);
        pinMode(LED2, OUTPUT);
        pinMode(LED3, OUTPUT);

        pinMode(RELAY_FAN, OUTPUT);
        pinMode(RELAY_HEATER1, OUTPUT);
        pinMode(RELAY_HEATER2, OUTPUT);

        pinMode(BUZZER_PIN, OUTPUT);
        buzzerForceSilent();
      #if BUZZER_BOOT_TEST_SEC > 0
        buzzerAlarmBlockingSeconds(BUZZER_BOOT_TEST_SEC);
      #endif

        pinMode(REED_PIN, INPUT_PULLUP);

        // ADC1 on GPIO35 (input-only). Plain INPUT — module drives AO; pull-down breaks many boards.
        pinMode(MOISTURE_PIN, INPUT);
        pinMode(MOISTURE_PIN_ALT, INPUT);
        analogReadResolution(12);
        #ifdef ARDUINO_ARCH_ESP32
          analogSetAttenuation(ADC_11db);
          analogSetPinAttenuation(MOISTURE_PIN, ADC_11db);
          analogSetPinAttenuation(MOISTURE_PIN_ALT, ADC_11db);
        #endif

        applySafeOutputDefaults();

      #if WIRING_CHECK_AT_BOOT
        runBootWiringCheck();
      #elif ENABLE_POWER_ON_SELFTEST
        applyBenchSelfTestOutputs();
      #elif LED_BOOT_SWEEP
        runBootLedSweep();
      #endif

        connectWifiBlocking();
        syncClockOnce();

        // MAC is only valid after WiFi.mode/begin. Load persisted assignment from NVS,
        // then immediately try to refresh from the cloud so the very first heartbeat
        // already targets the correct machines/{id} path.
        initIdentity();
        (void)refreshAssignmentFromCloud();
        clearCloudTestCommand();
        gLastTestRequestId = "";
        gTestMode = "";
        gTestComponent = "";
        gTestModeUntilMs = 0;
        gFaultBuzzerArmed = false;
        disengageBuzzerAlarm();
        applyLedsForSession(gSessionStatus.length() ? gSessionStatus : String("stopped"));

        Serial.println("---- IDENTITY ----");
        Serial.print("MAC          : "); Serial.println(gDeviceMac);
        Serial.print("Name         : "); Serial.println(gDeviceName);
        Serial.print("Assigned ID  : "); Serial.println(gAssignedId);
        if (gAssignedId > 0) {
          Serial.print("RTDB path    : machines/"); Serial.print(gAssignedId); Serial.println("/hardware_status");
        } else {
          Serial.println("RTDB path    : (none — id is 0)");
          Serial.println("              Overview + sensors read machines/{id}/hardware_status.");
          Serial.println("              Save the board in the app OR set RTDB assignments/{MAC} so id > 0.");
        }
        Serial.print("Discovery    : discovery/"); Serial.println(gDeviceMacSafe);
        Serial.println("------------------");

        // Moisture bounds will self-calibrate during runtime.

        dht.begin();

        // DHT22: allow sensor to stabilize after power-up before first read (avoids endless NaN).
        delay(2000);

        Serial.println("=== HEARTBEAT START ===");
        Serial.print("Polarity: RELAY_ACTIVE_LOW=");
        Serial.print(RELAY_ACTIVE_LOW ? 1 : 0);
        Serial.print(" LED_ON_IS_HIGH=");
        Serial.print(LED_ON_IS_HIGH ? 1 : 0);
        Serial.print(" START_WITH_OUTPUTS_ENERGIZED=");
        Serial.print(START_WITH_OUTPUTS_ENERGIZED ? 1 : 0);
        Serial.print(" WIRING_CHECK_AT_BOOT=");
        Serial.println(WIRING_CHECK_AT_BOOT ? 1 : 0);

        bool dhtOk = false, moistureOk = false, doorOk = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk);
        if (gAssignedId > 0) {
          refreshSessionFromCloud();
        }
        applySessionActuators(dhtOk, cachedDhtT);
        sendHeartbeat(dhtOk, moistureOk, doorOk);
        lastHeartbeatMs = millis();
      }

      void loop() {
        if (WiFi.status() != WL_CONNECTED) {
          connectWifiBlocking(8000);
        }

        bool dhtOk = false, moistureOk = false, doorOk = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk);

        if (millis() - gLastTestCmdPollMs >= 400UL) {
          gLastTestCmdPollMs = millis();
          refreshTestCommandFromCloud();
        }
        if (!hardwareTestActive() && gAssignedId > 0) {
          const unsigned long sessionPollMs =
            sessionStatusIsActive() ? 500UL : 1500UL;
          if (millis() - gLastSessionPollMs >= sessionPollMs) {
            gLastSessionPollMs = millis();
            refreshSessionFromCloud();
          }
        }
        tickHardwareTestOutputs();
        applySessionActuators(dhtOk, cachedDhtT);
        serviceBuzzer(dhtOk, moistureOk, doorSensorOkForAlerts(), cachedDhtT);

        if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
          sendHeartbeat(dhtOk, moistureOk, doorOk);
          lastHeartbeatMs = millis();
        }
        delay(5);
      }
