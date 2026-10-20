#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include "DHT.h"
#include <time.h>
#if defined(ESP32)
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_wifi.h"
#include "driver/gpio.h"
#endif
/** 1 = 16x2 LCD + 4x4 keypad local control. 0 = compile without those libraries. */
#ifndef ENABLE_LOCAL_HMI
#define ENABLE_LOCAL_HMI 1
#endif
#include "local_hmi.h"

// ============================================================================
//                       IDENTITY & ASSIGNMENT (NO HARDCODE)
// ----------------------------------------------------------------------------
//  This sketch is FLASHED IDENTICALLY to every ESP32 board.
//  Per-board identity comes from the MAC address. The numeric ID used by the
//  Laravel + mobile app is assigned AT RUNTIME by the user from the mobile
//  "Detect → Save" flow:
//    1. Board boots and keeps advertising at RTDB discovery/{MAC}/...
//       (new and already-saved boards both stay visible to Add Machine).
//    2. User taps "Detect Microcontrollers" in the app, sees this board.
//    3. User saves it. App writes  assignments/{MAC} = <numeric id>  to RTDB.
//    4. Board polls assignments/{MAC} every heartbeat, adopts the id, persists
//       it to NVS, and starts publishing to  machines/{id}/hardware_status.
//  No source edits required to add boards.
// ============================================================================

static String gDeviceMac;       // "AA:BB:CC:DD:EE:FF"
static String gDeviceMacSafe;   // "AABBCCDDEEFF"  (path-safe for RTDB)
static String gDeviceName;      // Friendly label. May change when the user saves a name.
static String gHardwareDeviceId; // Stable "Fish Dryer XXXX" from the MAC. Never renamed.
static int    gAssignedId = 0;  // 0 = not yet assigned; loaded from NVS
static Preferences gPrefs;

/** From RTDB `machines/{id}/session` — "running" / "paused" / "stopped". */
static String gSessionStatus = "stopped";
/** Fan demand 1..3 (from same RTDB node). Single relay: time‑multiplexed in `loop()`. */
static int gFanSpeedLevel = 1;
/** Drying target °C from RTDB session (used when session is `running`). */
static float gSessionTargetC = 60.0f;

/** Local LCD/keypad owns the session (machine can run without the phone). */
static bool gLocalHmiOwned = false;
static String gLocalFishType = "";
static int gLocalTotalFish = 0;
static int gLocalDurationMin = 0;
static int gLocalDurationSec = 0;
static long gRemainSec = 0;
static unsigned long gRemainTickMs = 0;
static unsigned long gLocalRunAccumMs = 0;
static unsigned long gLocalRunSegmentStartMs = 0;
static String gLocalOfflineId;
static unsigned long gLocalHmiStartGuardMs = 0;
/** Seq already in RTDB when the keypad pressed Start. Older commands are ignored. */
static unsigned long gSeqAtLocalStart = 0;
/** Keypad start must be uploaded to History. An app start is saved by the phone. */
static bool gKeypadOwnsHistory = false;
static int gHistPending = -1;
/** "duration" = timer finished. "user" = Stop was pressed. Empty while running. */
static char gStopReason[12] = "";
#ifndef HMI_HIST_QUEUE_MAX
#define HMI_HIST_QUEUE_MAX 8
#endif

static bool publishLocalSessionToRtdb(const char* statusWordIn);
static String newLocalOfflineId();
static unsigned long localHmiElapsedSeconds();
static void remainCatchUp();
static void remainArm();
static void remainFreeze();
static void remainSet(long sec);
static void queueHmiNetworkSync(const char* rtdbStatus, const char* apiAction);
static void flushHmiNetworkSync();
static void flushQueuedLocalHistory();
static void serviceLocalHmiKeys();
static bool postLocalSessionAction(const char* action);
static String buildLocalSessionPayload(const char* action);
static void queueLocalHistoryPayload(const String& payload);
static void markLocalHistorySynced(const String& offlineId);
static void migratePendIntoQueue();
static void consumeCloudCommandSeq(int mid);
static void persistActiveSession();
static void clearPersistedSession();
static void loadBootSnap();
static void applyBootSnap();
static bool gLastBeatOk = false;
static bool gSessionPersistEnabled = false;
static bool gHistFlushNow = false;
static bool gBootSnapValid = false;
static String gBootFish;
static int gBootQty = 0;
static float gBootTemp = 60.0f;
static int gBootDur = 0;
static unsigned long gBootElapsed = 0;
static int gBootFan = 1;
static bool gBootOwned = false;
static String gBootOid;
static bool gHoldPowerResume = false;
static bool gLocalApiStartAck = false;
static String gDeferredRtdbStatus;
static String gDeferredApiAction;

// ===== BUZZER (running session only) =====
//  Door opened after closed start | DHT22 fault | temp high: 10s on / 10s off.
//  Temp still below target after 10 min of drying: 3 min on, then quiet, repeat
//  every 10 min until the set temperature is reached.
//  Moisture probe never drives buzzer (spot-check in app only).
/** Max remote test length (ms). Keypad waits are extended in tick while user finishes. */
#ifndef HARDWARE_TEST_MAX_MS
#define HARDWARE_TEST_MAX_MS 600000UL
#endif
/** Fault pattern: 10 s ON, 10 s OFF, repeat (20 s cycle). */
#ifndef ALERT_BUZZ_ON_MS
#define ALERT_BUZZ_ON_MS 10000UL
#endif
#ifndef ALERT_BUZZ_SILENT_MS
#define ALERT_BUZZ_SILENT_MS 10000UL
#endif
/** Below target after this much drying time → start the low-temp alarm (10 min). */
#ifndef TEMP_BELOW_TARGET_AFTER_DRYING_MS
#define TEMP_BELOW_TARGET_AFTER_DRYING_MS (10UL * 60UL * 1000UL)
#endif
/** Low-temp alarm sounds this long, then stays quiet until the next 10 min mark. */
#ifndef TEMP_LOW_BUZZ_ON_MS
#define TEMP_LOW_BUZZ_ON_MS (3UL * 60UL * 1000UL)
#endif
#ifndef TEMP_LOW_BUZZ_EVERY_MS
#define TEMP_LOW_BUZZ_EVERY_MS (10UL * 60UL * 1000UL)
#endif
/** One relay fan: steady ON while drying (levels 1–3 stored for app/recommendations). */
#ifndef FAN_SPEED_CYCLE_MS
#define FAN_SPEED_CYCLE_MS 3000UL
#endif
#ifndef TEMP_TARGET_MARGIN_C
#define TEMP_TARGET_MARGIN_C 0.5f
#endif
/** Heat while DHT has no reading yet (session just started). */
#ifndef HEATER_DHT_BOOTSTRAP_MS
#define HEATER_DHT_BOOTSTRAP_MS (5UL * 60UL * 1000UL)
#endif
#ifndef ALERT_BUZZ_PERIOD_MS
#define ALERT_BUZZ_PERIOD_MS (ALERT_BUZZ_ON_MS + ALERT_BUZZ_SILENT_MS)
#endif
static bool          gBuzzerHwPwmOn = false;
static bool          gBuzzerAlarmEngaged = false;
/** Wall-clock start of 10s ON / 10s OFF cycle (survives long HTTP blocking). */
static unsigned long gBuzzerCycleAnchorMs = 0;
/** LCD "Problem:" line while drying. "None" when nothing is wrong. */
static char          gDryingProblemLine[17] = "None";
static unsigned long gLowTempBuzzWindowLogged = 0xFFFFFFFFUL;
static bool          gDrySessionLatched = false;
static unsigned long gLastSessionActiveMs = 0;
/** Wall clock when current `running` session started (for below-target buzzer). */
static unsigned long gDryingSessionStartMs = 0;
/** Session started with door closed → buzz if door opens mid-run. Open at start → suppress. */
static bool          gDoorClosedAtSessionStart = false;
static bool          gDoorOpenBuzzerSuppressed = false;
/** From RTDB session.fault_buzzer_armed — buzzer only (not fan/heaters). */
static bool          gFaultBuzzerArmed = false;
/** Paused + spot moisture check: buzz only when YL-69 probe is not working. */
static bool          gMoistureCheckArmed = false;
/** From RTDB session.session_active — true only while mobile drying is running. */
static bool          gSessionActiveFlag = false;
static uint8_t       gNullSessionPollStreak = 0;
static bool          gBuzzerPinHigh = false;
static bool          gWifiWasDown = false;
static bool          gNeedStatePublish = false;
static unsigned long gTestActuateUntilMs = 0;
static bool          gTestCombinedUiStarted = false;

// Remote hardware test from mobile → RTDB `machines/{id}/test_command`.
static String        gTestMode = "";           // "all" | "component" | ""
static String        gTestComponent = "";
static String        gLastTestRequestId = "";
static unsigned long gTestModeUntilMs = 0;
static unsigned long gLastTestCmdPollMs = 0;
static unsigned long gLastSessionPollMs = 0;
static unsigned long gLastSessionBodyPollMs = 0;
static int           gTestFanLevel = 3;
static const unsigned long ASSIGNMENT_POLL_UNASSIGNED_MS = 8000UL;
static const unsigned long ASSIGNMENT_POLL_ASSIGNED_MS = 60000UL;
static const unsigned long SESSION_POLL_MS = 3000UL;
static const unsigned long SESSION_BODY_POLL_MS = 12000UL;
static const unsigned long RTDB_GET_TIMEOUT_MS = 1200UL;

// ================= WIFI / API (no hardcoded PC IPv4) =================
const char* WIFI_SSID = "XuMinghao";
const char* WIFI_PASS = "Connecthere";

static       const char* FIRMWARE_BUILD_TAG = "sync-v126";

// Laravel heartbeat: keeps `last_seen` + hardware rows in MySQL and mirrors RTDB when enabled.
// Set to 0 only while debugging (e.g. API returns 500). If the app shows "offline" but RTDB
// discovery updates, this was probably 0 — Laravel never saw a heartbeat.
/** 0 = skip slow Laravel POST (fan/heaters keep working during drying). */
#ifndef SEND_TO_LARAVEL
#define SEND_TO_LARAVEL 0
#endif
/** 1 = poll RTDB test_command (Hardware Status Test / Test All → LCD + keypad + loads). */
#ifndef ENABLE_RTDB_HARDWARE_TEST
#define ENABLE_RTDB_HARDWARE_TEST 1
#endif

// ================= FIREBASE (set these before flashing) =================
// RTDB URL example: https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app/
// In Firebase RTDB "Test mode", you can write without auth tokens.
const char* FIREBASE_DATABASE_URL = "https://capstone-fish-dryer-default-rtdb.asia-southeast1.firebasedatabase.app";
/** Optional Database secret. Leave empty — RTDB rules are open, no login. */
const char* FIREBASE_DB_SECRET = "";

static String gLaravelApiBase; // "http://x.x.x.x:8000/api" from RTDB lan/server
static unsigned long gLastLanPollMs = 0;

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

// ================= ONE PIN PER COMPONENT (do not wire two things to one GPIO) =================
// NEVER use ESP32 strapping pins for loads: GPIO0 GPIO2 GPIO5 GPIO12 GPIO15.
//
// ================= TWO PLUGS ONLY (no laptop USB in normal use) =================
// Plug 1 — HEATER (AC): mains → SSR AC side → heater element (neutral direct to heater).
// Plug 2 — FAN PSU (AC→DC): switching supply powers fans AND all low-voltage control.
//   Fan PSU + → relay COM, relay NO → fan +, fan − → PSU −.
//   From the same PSU rail, add a 5 V buck (e.g. 12 V→5 V, ≥1 A) for:
//     ESP32 VIN (or 5 V pin) + GND  |  relay VCC + GND (JD-VCC jumper ON)
//   Share one common GND: PSU −, ESP32 GND, relay GND, SSR DC −, sensors GND.
//   Laptop USB is only for uploading firmware — unplug it when drying.
//   Do not connect USB and buck 5 V at the same time unless you know the grounds are safe.
//
// EXACT WIRING (user pin list):
//   DHT22 VCC→3.3V  GND→GND  DATA→GPIO4
//   Moisture VCC→3.3V  GND→GND  AO→GPIO35  (DO pin unconnected)
//   Reed: 10k GPIO34→3.3V, GPIO34→reed, reed→GND  (magnet near = LOW, open = HIGH)
//     GPIO34 is input-only — do NOT skip the 10k pull-up.
//   LED green: GPIO18→220Ω→LED+  LED−→GND
//   LED yellow: GPIO5→220Ω→LED+  LED−→GND
//   LED red: GPIO15→220Ω→LED+  LED−→GND
//   Buzzer +: GPIO17→220Ω→+  Buzzer −→GND
//   LCD I2C: VCC→5V  GND→GND  SDA→GPIO21  SCL→GPIO23  (0x27 / 0x3F)
//   Keypad pins 1→8 L→R: GPIO 13, 12, 14, 27, 26, 25, 33, 32
//     LEFT 1–4 = COLS 13,12,14,27    RIGHT 5–8 = ROWS 26,25,33,32
//   Fan relay (1-ch blue module): VCC→5V (NOT 3.3V)  GND→GND  IN→GPIO22  JD-VCC jumper ON
//     Fan load: COM + NO (normally open).
//     Single-channel module is active-low: IN LOW = coil ON (click, module LED on).
//     Drying = GPIO LOW. Stopped = GPIO HIGH (coil off, fan off).
//     No CLICK but LED changes? Coil lacks 5V — fix VCC/JD-VCC/GND, not the ESP32 code.
//              COM→switching PSU +  NO→fan red  fan black→PSU −
//   SSR-60 DA heater (ONE SSR):
//     AC OUTPUT terminals 1–2: 1→plug LIVE  2→heater wire
//        (heater return → plug NEUTRAL — not through the SSR)
//     DC INPUT terminals 3–4: 3(+)→GPIO19  4(−)→GND
//     GPIO19 HIGH = drying session running. GPIO19 LOW = stopped/paused.
//     GPIO18 is the green LED — do not wire a second SSR there.
#define PIN_DHT22        4
#define PIN_MOISTURE    35
#define PIN_DOOR        34    // input-only; 10k pull-up to 3.3V required
#define PIN_FAN         22
#define PIN_HEATER1     19    // SSR DC+ (single heater)
#if ENABLE_LOCAL_HMI
#define PIN_HEATER2     PIN_HEATER1
#else
#define PIN_HEATER2     PIN_HEATER1
#endif
#define PIN_BUZZER      17
#define PIN_LED_GREEN   18
#define PIN_LED_YELLOW   5
#define PIN_LED_RED     15

#define DHTPIN           PIN_DHT22
#define MOISTURE_PIN     PIN_MOISTURE
#define REED_PIN         PIN_DOOR
#define RELAY_FAN        PIN_FAN
#define RELAY_HEATER1    PIN_HEATER1
#define RELAY_HEATER2    PIN_HEATER2
#define BUZZER_PIN       PIN_BUZZER
#define LED1             PIN_LED_GREEN
#define LED2             PIN_LED_YELLOW
#define LED3             PIN_LED_RED
#define LED_GREEN        PIN_LED_GREEN
#define LED_YELLOW       PIN_LED_YELLOW
#define LED_RED          PIN_LED_RED

// Fan relay IN on GPIO22. Single-channel module: LOW = coil ON, HIGH = coil OFF.
#ifndef RELAY_ACTIVE_LOW
#define RELAY_ACTIVE_LOW 1
#endif
// 1 = GPIO LOW while drying (click, fan on), GPIO HIGH when stopped (fan off).
#ifndef FAN_RELAY_ACTIVE_LOW
#define FAN_RELAY_ACTIVE_LOW 1
#endif
/** Float IN like unplugging jumper (ms). */
#ifndef FAN_RELAY_FLOAT_MS
#define FAN_RELAY_FLOAT_MS 250
#endif
/** Hold ON after reconnect (ms) so relay latches. */
#ifndef FAN_RELAY_HOLD_MS
#define FAN_RELAY_HOLD_MS 400
#endif
// He aters on SSR-60DA. If heaters use blue relays like fan, set HEATER_CONTROL_IS_SSR to 0.
#ifndef HEATER_CONTROL_IS_SSR
#define HEATER_CONTROL_IS_SSR 1
#endif
/** 0 = GPIO19→SSR3(+), GND→SSR4(−). 1 = alternate 5V→SSR3, GPIO19→SSR4. */
#ifndef HEATER_SSR_SINK_5V
#define HEATER_SSR_SINK_5V 0
#endif
/** 0 = GPIO HIGH = heater ON (SSR-60DA DC+ on GPIO19). 1 was inverted: idle HIGH cooked the heater. */
#ifndef HEATER_SSR_ACTIVE_LOW
#define HEATER_SSR_ACTIVE_LOW 0
#endif
/** Boot pulse (0 = off — heater must stay cold until app Start). */
#ifndef HEATER_BOOT_CLICK_MS
#define HEATER_BOOT_CLICK_MS 0
#endif
/** Always heat this long after Start (even if DHT missing / reads high). */
#ifndef SESSION_HEATER_WARMUP_MS
#define SESSION_HEATER_WARMUP_MS (60UL * 1000UL)
#endif
/** 1 = heater ON entire drying session (same as fan). 0 = thermostat vs target temp. */
#ifndef HEATER_MIRROR_FAN
#define HEATER_MIRROR_FAN 0
#endif
#ifndef RELAY_BOOT_CLICK_MS
#define RELAY_BOOT_CLICK_MS 0
#endif
#ifndef LED_ON_IS_HIGH
#define LED_ON_IS_HIGH 1
#endif
#ifndef START_WITH_OUTPUTS_ENERGIZED
#define START_WITH_OUTPUTS_ENERGIZED 0
#endif

// Loudest passive piezo: ~4 kHz square wave, full rail (resonance band).
#ifndef BUZZER_TONE_HZ
#define BUZZER_TONE_HZ 4096
#endif
#ifndef BUZZER_PWM_DUTY
#define BUZZER_PWM_DUTY 128
#endif
/** 0 = unassigned boards must not publish to machines/1/ until the app assigns them. */
#ifndef FALLBACK_MACHINE_ID
#define FALLBACK_MACHINE_ID 0
#endif
#ifndef ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT
#define ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT 0
#endif
/** 1 = 3-pin active buzzer (steady HIGH). 0 = passive piezo on GPIO17 (needs PWM/tone). */
#ifndef BUZZER_ACTIVE_HIGH
#define BUZZER_ACTIVE_HIGH 1
#endif
/** Loud chirp when drying starts. 0 = off. */
#ifndef BUZZER_DRYING_START_CHIRP_MS
#define BUZZER_DRYING_START_CHIRP_MS 120
#endif
#ifndef SESSION_ACTIVE_HOLD_MS
#define SESSION_ACTIVE_HOLD_MS 15000UL
#endif
/** Beep at boot (proves GPIO17). 0 = off after wiring verified. */
#ifndef BUZZER_BOOT_TEST_SEC
#define BUZZER_BOOT_TEST_SEC 0
#endif

static bool gBuzzerTonePlaying = false;
static uint32_t gBuzzerLastToggleUs = 0;
static bool gBuzzerPinLevel = false;

static bool sessionAllowsActuators();
static bool dryingSessionOutputsActive();
static bool intendedHeaterOnForSession(bool dhtOk, float airC);
static bool parseJsonBoolAfterKey(const String& body, const char* key, bool defV);
static void beginDryingOutputs(bool chirp);
static int findMachineIdForMacInMachinesJson();
static int effectiveSessionMachineId();
static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody,
                        unsigned long timeoutMs = 1200UL);
static void holdHardwareTestActuators();
static void refreshLaravelBaseFromRtdb();

#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

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

/** Set 1 to skip touch "wire present" test (required when PIN_DOOR is GPIO16 — no touch pad). */
#ifndef DOOR_SENSOR_SKIP_TOUCH_CHECK
#define DOOR_SENSOR_SKIP_TOUCH_CHECK 1
#endif

/** Max LOW/HIGH toggles during the jitter window; raise if a noisy line fails a good sensor. */
#ifndef DOOR_SENSOR_MAX_JITTER_TRANSITIONS
#define DOOR_SENSOR_MAX_JITTER_TRANSITIONS 255
#endif

/**
 * 0 = no door hardware: always publish door_sensor as not_working.
 * 1 = reed wired on PIN_DOOR (GPIO16): run doorSensorElectricalOk().
 */
#ifndef HAVE_DOOR_SENSOR
#define HAVE_DOOR_SENSOR 1
#endif

/** After discharging GPIO16, MC38 wiring rises slower than a bare pin (microseconds). */
#ifndef DOOR_WIRE_BARE_RISE_US
#define DOOR_WIRE_BARE_RISE_US 15
#endif
/** Consecutive ultra-fast rise readings (= bare GPIO) before not_working. */
#ifndef DOOR_WIRE_BARE_STREAK_CLEAR
#define DOOR_WIRE_BARE_STREAK_CLEAR 8
#endif

/** Touch channel (only if PIN_DOOR is a touch pad, e.g. GPIO15=T3). Unused on GPIO16. */
#ifndef REED_TOUCH_CHANNEL
#define REED_TOUCH_CHANNEL T3
#endif

static inline bool gpioIsInputOnly(int pin) {
  return pin == 34 || pin == 35 || pin == 36 || pin == 39;
}

static inline void doorPinAsInput() {
  if (gpioIsInputOnly(REED_PIN)) {
    pinMode(REED_PIN, INPUT);
  } else {
    pinMode(REED_PIN, INPUT_PULLUP);
  }
}

unsigned long lastHeartbeatMs = 0;
static unsigned long gLastPresenceOkMs = 0;
static unsigned long gLastPresenceAttemptMs = 0;
static unsigned long gLastDiscoveryOkMs = 0;
static unsigned long gLastDiscoveryAttemptMs = 0;
static uint32_t gDiscoverySeq = 0;
static bool gLastPresenceFailed = false;
/** Light Online pulse. Runs even while the keypad screen is open. */
const unsigned long PRESENCE_INTERVAL_MS = 2000;
/** Full sensor snapshot. Live temp, humidity, and time go out on the pulse. */
const unsigned long HEARTBEAT_INTERVAL_MS = 8000;

// DHT22 requires ≥ ~2 s between reads; polling faster returns NaN and makes status flicker.
static unsigned long lastDhtPollMs = 0;
static float cachedDhtT = NAN;
static float cachedDhtH = NAN;
static bool lastDhtReadOk = false;
static unsigned long gLastGoodDhtMs = 0;
/** Same numbers the LCD and the app show. */
static float gLiveTempC = NAN;
static float gLiveHum = NAN;
static int gLiveMoisturePct = -1;
static int gMoistureAvgCached = 0;
static int gMoistureSpreadCached = 0;
static int gMoistureMinCached = 4095;
static int gMoistureMaxCached = 0;
static unsigned long gLastMoistureSampleMs = 0;

static inline void driveLed(int pin, bool on) {
  pinMode(pin, OUTPUT);
  const bool levelHigh = LED_ON_IS_HIGH ? on : !on;
  digitalWrite(pin, levelHigh ? HIGH : LOW);
}

static inline int relayPinLevelFor(bool coilOn, bool activeLow) {
  if (activeLow) {
    return coilOn ? LOW : HIGH;
  }
  return coilOn ? HIGH : LOW;
}

static inline int relayPinLevel(bool coilOn) {
  return relayPinLevelFor(coilOn, RELAY_ACTIVE_LOW != 0);
}

static inline void driveRelay(int pin, bool coilEnergized) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, relayPinLevel(coilEnergized));
}

/** Last commanded fan coil state (not GPIO read — initLoadPins must stay in sync). */
static bool sFanRelayCoilCommandedOn = false;
/** Mechanical relay needs reconnect edge after every idle period. */
static bool sFanNeedWakePulse = true;
static bool sFanSessionOutputsWereActive = false;
/** Last commanded heater state (open-drain sink mode cannot rely on digitalRead). */
static bool sHeaterCommandedOn = false;
static bool sHeaterSinkOdReady = false;

/** Levels for fan relay IN (separate from heater SSR polarity). */
static inline int fanRelayLevelOff() {
  return relayPinLevelFor(false, FAN_RELAY_ACTIVE_LOW != 0);
}
static inline int fanRelayLevelOn() {
  return relayPinLevelFor(true, FAN_RELAY_ACTIVE_LOW != 0);
}

/** Drive fan GPIO every time — never float the pin (float = coil ON on active-low modules). */
static inline void driveFanLoad(bool on) {
  const int level = on ? fanRelayLevelOn() : fanRelayLevelOff();
  pinMode(RELAY_FAN, OUTPUT);
#if defined(ESP32)
  gpio_set_drive_capability((gpio_num_t)RELAY_FAN, GPIO_DRIVE_CAP_3);
#endif
  digitalWrite(RELAY_FAN, level);
  sFanRelayCoilCommandedOn = on;
  sFanNeedWakePulse = false;
}

static inline void forceFanRelayWakeOn() {
  driveFanLoad(true);
}

#if defined(ESP32) && HEATER_CONTROL_IS_SSR && HEATER_SSR_SINK_5V
static void heaterSinkOdInitOnce() {
  if (sHeaterSinkOdReady) return;
  gpio_config_t c = {};
  c.pin_bit_mask = (1ULL << RELAY_HEATER1);
  c.mode = GPIO_MODE_OUTPUT_OD;
  c.pull_up_en = GPIO_PULLUP_DISABLE;
  c.pull_down_en = GPIO_PULLDOWN_DISABLE;
  c.intr_type = GPIO_INTR_DISABLE;
  gpio_config(&c);
  gpio_set_drive_capability((gpio_num_t)RELAY_HEATER1, GPIO_DRIVE_CAP_3);
  sHeaterSinkOdReady = true;
}
#endif

/** Drive one heater GPIO. HEATER2 is the same pin as HEATER1 on this board. */
static inline void driveHeaterGpio(int pin, bool on) {
#if HEATER_CONTROL_IS_SSR
#if HEATER_SSR_SINK_5V
#if defined(ESP32)
  if (pin == RELAY_HEATER1) {
    heaterSinkOdInitOnce();
    gpio_set_level((gpio_num_t)pin, on ? 0 : 1);
    return;
  }
#endif
  pinMode(pin, OUTPUT);
  digitalWrite(pin, on ? LOW : HIGH);
#else
  pinMode(pin, OUTPUT);
#if defined(ESP32)
  gpio_set_drive_capability((gpio_num_t)pin, GPIO_DRIVE_CAP_3);
#endif
#if HEATER_SSR_ACTIVE_LOW
  digitalWrite(pin, on ? LOW : HIGH);
#else
  digitalWrite(pin, on ? HIGH : LOW);
#endif
#endif
#else
  pinMode(pin, OUTPUT);
  driveRelay(pin, on);
#endif
}

/** SSR-60DA on GPIO19: HIGH = drying ON. Never write HEATER2 if it aliases HEATER1. */
static inline void driveHeaterLoad(bool on) {
  sHeaterCommandedOn = on;
  driveHeaterGpio(RELAY_HEATER1, on);
  if (RELAY_HEATER2 != RELAY_HEATER1) {
    driveHeaterGpio(RELAY_HEATER2, on);
  }
}

static bool fanLoadIsOn() {
  const int v = digitalRead(RELAY_FAN);
  return FAN_RELAY_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
}

static bool heaterLoadIsOn(int pin) {
  if (pin != RELAY_HEATER1) {
  #if HEATER_CONTROL_IS_SSR
    return false;
  #else
    return relayOn(pin);
  #endif
  }
#if HEATER_CONTROL_IS_SSR && HEATER_SSR_SINK_5V
  return sHeaterCommandedOn;
#elif HEATER_CONTROL_IS_SSR && HEATER_SSR_ACTIVE_LOW
  return digitalRead(pin) == LOW;
#elif HEATER_CONTROL_IS_SSR
  return digitalRead(pin) == HIGH;
#else
  return relayOn(pin);
#endif
}

/** RTDB `outputs` — report actual GPIO levels (not thermostat intent alone). */
static void appendOutputsTelemetry(String& root, bool dhtOk, float airC) {
  bool fanRep = false;
  bool h1Rep = false;
  bool h2Rep = false;
  bool h1Demand = false;
  if (hardwareTestActive()) {
    fanRep = fanLoadIsOn();
    h1Rep = heaterLoadIsOn(RELAY_HEATER1);
    h2Rep = heaterLoadIsOn(RELAY_HEATER2);
  } else if (dryingSessionOutputsActive()) {
    fanRep = fanLoadIsOn();
    h1Demand = intendedHeaterOnForSession(dhtOk, airC);
    h1Rep = heaterLoadIsOn(RELAY_HEATER1);
    h2Rep = heaterLoadIsOn(RELAY_HEATER2);
  }
  root += "\"fan_on\":"; root += fanRep ? "true" : "false";
  root += ",\"heater1_on\":"; root += h1Rep ? "true" : "false";
  root += ",\"heater2_on\":"; root += h2Rep ? "true" : "false";
  root += ",\"heater1_demand\":"; root += h1Demand ? "true" : "false";
  root += ",\"led1_on\":"; root += ledPinOn(LED1) ? "true" : "false";
  root += ",\"led2_on\":"; root += ledPinOn(LED2) ? "true" : "false";
  root += ",\"led3_on\":"; root += ledPinOn(LED3) ? "true" : "false";
  root += ",\"buzzer_on\":"; root += gBuzzerTonePlaying ? "true" : "false";
}

/** Boot bench test: you should hear/feel one relay click if VCC=5V and IN on GPIO22. */
static void relayBootClickTest() {
#if RELAY_BOOT_CLICK_MS > 0
  Serial.println("[relay] boot click test — should hear relay CLICK once");
  driveFanLoad(true);
  delay((unsigned long)RELAY_BOOT_CLICK_MS);
  driveFanLoad(false);
  Serial.print("[relay] IN pin GPIO");
  Serial.print(RELAY_FAN);
  Serial.print(" level after test=");
  Serial.println(digitalRead(RELAY_FAN));
  Serial.println("[relay] No click? VCC must be 5V, GND shared with ESP32, JD-VCC jumper ON.");
  Serial.println("[relay] Fan on COM+NO. LED-only change = optocoupler OK, coil not powered.");
#endif
}

/** Boot SSR pulse — GPIO19 HIGH = ON (GPIO19→SSR3+, GND→SSR4-). */
static void heaterBootClickTest() {
#if HEATER_BOOT_CLICK_MS > 0 && HEATER_CONTROL_IS_SSR
  Serial.println("[heater] boot test — GPIO19 LOW ~3s, SSR LED should light");
  driveHeaterLoad(true);
  delay((unsigned long)HEATER_BOOT_CLICK_MS);
  driveHeaterLoad(false);
  Serial.print("[heater] gpio19=");
  Serial.println(digitalRead(RELAY_HEATER1));
#endif
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
  // A DHT retry blocks for >100 ms and the typed character misses that click.
  if (!LocalHmi::uiSelfTestActive() &&
      (LocalHmi::isEnteringParams() || LocalHmi::wantsNetworkQuiet())) {
    return lastDhtReadOk;
  }

  // ESP32 Wi‑Fi stack can disturb the DHT one‑wire timing. Let the radio yield, then read
  // in the order the Adafruit examples use (humidity first, then temperature).
  yield();
  delay(50);
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  bool plausible = dhtReadPlausible(t, h);
  if (!plausible) {
    delay(120);
    yield();
    h = dht.readHumidity();
    t = dht.readTemperature();
    plausible = dhtReadPlausible(t, h);
  }

  // Timestamp after the acquisition so the next poll is ≥2 s later (library also enforces).
  lastDhtPollMs = millis();

  if (plausible) {
    cachedDhtT = t;
    cachedDhtH = h;
    gLastGoodDhtMs = millis();
    lastDhtReadOk = true;
  } else {
    cachedDhtT = NAN;
    cachedDhtH = NAN;
    lastDhtReadOk = false;
  }
  return lastDhtReadOk;
}

String statusWord(bool ok) { return ok ? "working" : "not_working"; }
/** Working only after a stable probe reading. A floating pin is not_working. */
String moistureStatusWord(bool connected) {
  return connected ? "working" : "not_working";
}
String statusUnknown() { return "unknown"; }

// YL-69 on GPIO35. AO falls as the sample gets wetter: air sits near
// full scale and was stuck at 100% while percent followed the ADC.
// Water lowers the ADC, so percent is the inverse of that reading.
static int clampInt(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** ADC 4095 (dry / air) = 0%. ADC 0 (wet / water) = 100%. */
static int moisturePercentFromAdc(int adc) {
  adc = clampInt(adc, 0, 4095);
  const int dryHigh = (int)lroundf((float)adc * 100.0f / 4095.0f);
  return 100 - dryHigh;
}

static int gMoisturePctSmooth = -1;
static bool gMoistureHaveSample = false;
static bool gMoistureConnected = false;
static uint8_t gMoistureGoodStreak = 0;

/** Follow the probe. A wet or dry touch shows up on the next sample. */
static int smoothMoisturePercent(int pct) {
  pct = clampInt(pct, 0, 100);
  if (gMoisturePctSmooth < 0) {
    gMoisturePctSmooth = pct;
  } else {
    gMoisturePctSmooth = (gMoisturePctSmooth + pct * 3) / 4;
  }
  return clampInt(gMoisturePctSmooth, 0, 100);
}

#ifndef MOISTURE_ADC_SAMPLES
#define MOISTURE_ADC_SAMPLES 16
#endif

/** Latched ON after RTDB start until explicit stop (survives flaky GETs). */
static bool gDryingOutputsLatched = false;
/** Last processed `machines/{id}/command.seq` (mobile + Laravel write here). */
static unsigned long gLastCommandSeq = 0;
/** Seq we last wrote or applied. A different seq is a new phone command. */
static unsigned long gBoardPublishedSeq = 0;
static String gLastAppliedCommandAction;
static String gLastCommandUpdated;
/** Ignore stale RTDB `running` until this time (prevents fan/heat on at boot). */
static unsigned long gBootMs = 0;
static unsigned long gIgnoreStaleRunningUntilMs = 0;
/** Drop app Start commands that arrive right after a keypad Stop. */
static unsigned long gIgnoreCloudStartUntilMs = 0;
/** Fan/heat ONLY after app Start (command seq) — not stale RTDB status=running. */
static bool gDryRunAuthorized = false;

static void readMoistureAdcOnPin(int pin, int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
  int samples[MOISTURE_ADC_SAMPLES];
  (void)analogRead(pin);
  delay(1);
  int minV = 4095;
  int maxV = 0;
  for (int i = 0; i < MOISTURE_ADC_SAMPLES; i++) {
    const int v = analogRead(pin);
    samples[i] = v;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    delayMicroseconds(200);
  }
  for (int i = 1; i < MOISTURE_ADC_SAMPLES; i++) {
    const int key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }
  avgOut = samples[MOISTURE_ADC_SAMPLES / 2];
  spreadOut = maxV - minV;
  minOut = minV;
  maxOut = maxV;
}

static void readMoistureAdc(int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
  int avg2 = 0;
  int spread2 = 0;
  int min2 = 0;
  int max2 = 0;
  readMoistureAdcOnPin(PIN_MOISTURE, avgOut, spreadOut, minOut, maxOut);
  delay(2);
  readMoistureAdcOnPin(PIN_MOISTURE, avg2, spread2, min2, max2);
  (void)min2;
  (void)max2;
  if (spread2 > spreadOut) spreadOut = spread2;
  avgOut = (avgOut + avg2) / 2;
  // A bare GPIO35 wanders across most of 0..4095. A YL-69 in water is noisier
  // than dry air and the ADC moves when the probe is dipped, but the samples
  // stay in a band. That move is the moisture reading, not a disconnect.
  const bool floating = spreadOut >= 2000;
  if (floating) {
    gMoistureGoodStreak = 0;
    gMoistureConnected = false;
    gMoistureHaveSample = false;
    gLiveMoisturePct = -1;
    gMoisturePctSmooth = -1;
    return;
  }
  if (gMoistureGoodStreak < 250) gMoistureGoodStreak++;
  if (gMoistureGoodStreak < 2) {
    gMoistureConnected = false;
    gMoistureHaveSample = false;
    gLiveMoisturePct = -1;
    return;
  }
  gMoistureConnected = true;
  gMoistureHaveSample = true;
  gLiveMoisturePct = smoothMoisturePercent(moisturePercentFromAdc(avgOut));
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
  return doorSensorElectricalOk();
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
  doorPinAsInput();
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

static int gLastDoorCapLowSamples = -1;
static bool gDoorWireLatched = false;
static uint8_t gDoorBarePinStreak = 0;

/**
 * Magnet apart and unplugged GPIO both read steady HIGH with INPUT_PULLUP.
 * Discharge the line, then measure how many µs until pull-up wins.
 * MC38 wiring is slower than a bare GPIO16 pin.
 */
static unsigned long doorWireRiseMicrosAfterHighState() {
  if (gpioIsInputOnly(REED_PIN)) {
    return 100UL;
  }
  pinMode(REED_PIN, OUTPUT);
  digitalWrite(REED_PIN, LOW);
  delay(2);
  pinMode(REED_PIN, INPUT_PULLUP);

  const unsigned long t0 = micros();
  unsigned long riseUs = 0;
  while (digitalRead(REED_PIN) == LOW) {
    riseUs = micros() - t0;
    if (riseUs > 4000UL) {
      break;
    }
  }
  doorPinAsInput();
  gLastDoorCapLowSamples = (int)(riseUs / 10UL);
  return riseUs;
}

static bool doorWirePresentAfterHighState() {
  const unsigned long riseUs = doorWireRiseMicrosAfterHighState();
  return riseUs > DOOR_WIRE_BARE_RISE_US;
}

/** MC38 on GPIO34: magnet near (door closed) = LOW, door open = HIGH (10k to 3.3V). */
static void readDoorSensorSample(int& highs, int& lows, int& transitions) {
  doorPinAsInput();
  delayMicroseconds(100);
  highs = 0;
  lows = 0;
  transitions = 0;
  int last = -1;
  for (int i = 0; i < 32; i++) {
    const int v = digitalRead(REED_PIN);
    if (v == HIGH) {
      highs++;
    } else {
      lows++;
    }
    if (last >= 0 && v != last) {
      transitions++;
    }
    last = v;
    delayMicroseconds(400);
  }
}

static bool doorSensorOkFromSample(int highs, int lows, int transitions) {
#if !HAVE_DOOR_SENSOR
  (void)highs;
  (void)lows;
  (void)transitions;
  gLastDoorCapLowSamples = -1;
  return false;
#else
  gLastDoorCapLowSamples = -1;
  // A floating input chatters. A wired reed is steady high or steady low.
  if (transitions > 4) return false;
  if (lows >= 28) return true;
  if (highs < 28) return false;
  // GPIO34 has no pull-up of its own. Steady HIGH is "door open" only when the
  // external 10k holds the ADC still. A floating pin must not say Open.
  static unsigned long sDoorAdcMs = 0;
  static bool sDoorHighWired = false;
  const unsigned long nowMs = millis();
  if (sDoorAdcMs == 0 || (nowMs - sDoorAdcMs) >= 700UL) {
    sDoorAdcMs = nowMs;
    int avg = 0;
    int spread = 0;
    int mn = 0;
    int mx = 0;
    readMoistureAdcOnPin(PIN_DOOR, avg, spread, mn, mx);
    sDoorHighWired = spread <= 250 && avg >= 2000;
  }
  return sDoorHighWired;
#endif
}

static bool doorIsOpenFromSample(int highs, int lows) {
  return highs > lows;
}

static void resetDoorOpenBuzzerPolicy() {
  gDoorClosedAtSessionStart = false;
  gDoorOpenBuzzerSuppressed = false;
}

/** Arm door-open buzzer only when drying starts with a closed, working door sensor. */
static void latchDoorOpenBuzzerPolicyAtSessionStart() {
#if !HAVE_DOOR_SENSOR
  resetDoorOpenBuzzerPolicy();
  return;
#else
  int highs = 0;
  int lows = 0;
  int transitions = 0;
  readDoorSensorSample(highs, lows, transitions);
  const bool doorOk = doorSensorOkFromSample(highs, lows, transitions);
  const bool doorOpen = doorIsOpenFromSample(highs, lows);
  if (!doorOk) {
    resetDoorOpenBuzzerPolicy();
    return;
  }
  if (doorOpen) {
    gDoorOpenBuzzerSuppressed = true;
    gDoorClosedAtSessionStart = false;
    Serial.println("[buzzer] door-open alarm suppressed — started with door open");
  } else {
    gDoorOpenBuzzerSuppressed = false;
    gDoorClosedAtSessionStart = true;
    Serial.println("[buzzer] door-open alarm armed — started with door closed");
  }
#endif
}

/** Buzz when door opens mid-run after a closed start (not when user started with door open). */
static bool doorOpenedDuringDryingFault(bool doorSensorOk, bool doorOpen) {
#if !HAVE_DOOR_SENSOR
  (void)doorSensorOk;
  (void)doorOpen;
  return false;
#else
  if (!sessionStatusIsRunning()) {
    return false;
  }
  if (gDoorOpenBuzzerSuppressed || !gDoorClosedAtSessionStart) {
    return false;
  }
  return doorSensorOk && doorOpen;
#endif
}

/**
 * Reed health on GPIO16: stable LOW = wired; stable HIGH needs capacitance wire test;
 * noisy pin = not_working.
 */
static bool doorSensorElectricalOk() {
#if DOOR_SENSOR_SKIP_TOUCH_CHECK
  int highs = 0;
  int lows = 0;
  int transitions = 0;
  readDoorSensorSample(highs, lows, transitions);
  return doorSensorOkFromSample(highs, lows, transitions);
#else
  if (!doorWireConnected()) {
    return false;
  }
  int highs = 0;
  int lows = 0;
  int transitions = 0;
  readDoorSensorSample(highs, lows, transitions);
  if (transitions > DOOR_SENSOR_MAX_JITTER_TRANSITIONS) {
    return false;
  }
  return doorSensorOkFromSample(highs, lows, transitions);
#endif
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
  return gTestMode.length() > 0;
}

/** Hardware test (RTDB test_command) is only for the Components screen — never during drying. */
static bool sessionBlocksHardwareTest() {
  return gDryingOutputsLatched || sessionStatusIsRunning();
}

/** Stop local test outputs only — do not touch RTDB test_command (Hardware page owns that). */
static void pauseLocalHardwareTestOnly() {
  if (gTestMode.length() == 0 && !hardwareTestActive()) {
    return;
  }
  gTestMode = "";
  gTestComponent = "";
  gTestModeUntilMs = 0;
  buzzerForceSilent();
  if (!gDryingOutputsLatched) {
    loadsHardwareAllOff();
  }
#if ENABLE_LOCAL_HMI
  LocalHmi::endUiSelfTest();
#endif
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

static bool sessionAllowsActuators() {
  return sessionStatusIsRunning();
}

/** Fan/heaters only after explicit app Start (not leftover RTDB status=running). */
static bool dryingSessionOutputsActive() {
  return gDryRunAuthorized && sessionStatusIsRunning();
}

static float gLastGoodAirC = NAN;
static unsigned long gLastGoodAirMs = 0;
static bool sHeaterThermostatOn = false;

static void clearHeaterTempMemory() {
  gLastGoodAirC = NAN;
  gLastGoodAirMs = 0;
  sHeaterThermostatOn = false;
}

/** DHT can glitch; keep last good reading briefly — never fake a temp (that locked heaters ON). */
static float airCToUseForHeater(bool dhtOk, float airC) {
  if (dhtOk && !isnan(airC)) {
    gLastGoodAirC = airC;
    gLastGoodAirMs = millis();
    return airC;
  }
  if (!isnan(gLastGoodAirC) && (millis() - gLastGoodAirMs) < 15000UL) {
    return gLastGoodAirC;
  }
  return NAN;
}

/**
 * Thermostat: heat while air is below target; cut heater once at/above target.
 * No reading yet: heat only during the DHT bootstrap window so a dead sensor
 * cannot leave the element on forever.
 */
static bool heaterDemandVsTarget(bool dhtOk, float airC) {
  if (!dryingSessionOutputsActive()) {
    sHeaterThermostatOn = false;
    return false;
  }
#if HEATER_MIRROR_FAN
  sHeaterThermostatOn = true;
  return true;
#endif
  if (gSessionTargetC <= 1.0f) {
    gSessionTargetC = 60.0f;
  }
  const float t = airCToUseForHeater(dhtOk, airC);
  if (isnan(t)) {
    const bool bootstrap =
        (gDryingSessionStartMs > 0) &&
        ((millis() - gDryingSessionStartMs) < HEATER_DHT_BOOTSTRAP_MS);
    sHeaterThermostatOn = bootstrap;
    return bootstrap;
  }
  // Hysteresis: stay ON until target, stay OFF until 0.5°C below target.
  if (t >= gSessionTargetC) {
    sHeaterThermostatOn = false;
  } else if (t < (gSessionTargetC - TEMP_TARGET_MARGIN_C) || !sHeaterThermostatOn) {
    sHeaterThermostatOn = true;
  }
  return sHeaterThermostatOn;
}

/** Heater demand while drying (matches serviceHeatersForSession). */
static bool intendedHeaterOnForSession(bool dhtOk, float airC) {
  return heaterDemandVsTarget(dhtOk, airC);
}

static bool dryingSessionRunning() {
  return sessionStatusIsRunning();
}

/**
 * Drying fault buzzer: DHT electrical fault only.
 * Door opening mid-run and temperature faults are handled separately.
 */
static bool sensorsBadForBuzzer(bool dhtOk, bool moistureOk, bool doorOk) {
  (void)moistureOk;
  (void)doorOk;
  return !dhtOk;
}

/**
 * Buzzer should be considered for faults only while a drying session is running.
 * Previously this required `gFaultBuzzerArmed` (RTDB flag) which prevented the
 * buzzer from engaging during active runs unless explicitly armed remotely.
 * Change: consider the session running state only so sensor/temp faults alarm
 * during any active drying session.
 */
static bool dryingSessionActiveForBuzzer() {
  return sessionStatusIsRunning();
}

/** Milliseconds the heaters have actually been running (pause does not count). */
static unsigned long dryingRunElapsedMs() {
  unsigned long ms = gLocalRunAccumMs;
  if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
    ms += (millis() - gLocalRunSegmentStartMs);
  } else if (ms == 0 && sessionStatusIsRunning() && gDryingSessionStartMs > 0) {
    ms = millis() - gDryingSessionStartMs;
  }
  return ms;
}

static bool tempHighForBuzzer(bool dhtOk, float airC) {
  if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) return false;
  if (!dhtOk || isnan(airC) || gSessionTargetC <= 1.0f) return false;
  return airC > (gSessionTargetC + TEMP_TARGET_MARGIN_C);
}

/** Still under the set temperature after 10 minutes of drying. */
static bool tempLowAfterWarmup(bool dhtOk, float airC) {
  if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) return false;
  if (!dhtOk || isnan(airC) || gSessionTargetC <= 1.0f) return false;
  if (airC >= (gSessionTargetC - TEMP_TARGET_MARGIN_C)) return false;
  return dryingRunElapsedMs() >= TEMP_BELOW_TARGET_AFTER_DRYING_MS;
}

/** 3 minutes on at each 10-minute mark, starting at the 10-minute point. */
static bool lowTempBuzzWindowOpen(unsigned long elapsedMs) {
  if (elapsedMs < TEMP_BELOW_TARGET_AFTER_DRYING_MS) return false;
  const unsigned long since = elapsedMs - TEMP_BELOW_TARGET_AFTER_DRYING_MS;
  return (since % TEMP_LOW_BUZZ_EVERY_MS) < TEMP_LOW_BUZZ_ON_MS;
}

static void setDryingProblemLine(const char* text) {
  snprintf(gDryingProblemLine, sizeof(gDryingProblemLine), "%s", text ? text : "None");
}

static void applyFanSpeedForSession() {
  serviceFanSpeedRelay(millis());
}

/** Single relay fan: ON for entire drying session. Idle = GPIO held at OFF level. */
static void serviceFanSpeedRelay(unsigned long nowMs) {
  (void)nowMs;
  if (!dryingSessionOutputsActive()) {
    sFanSessionOutputsWereActive = false;
    driveFanLoad(false);
    return;
  }
  sFanSessionOutputsWereActive = true;
  driveFanLoad(true);
}

/** Heaters: on while below target, off at/above target (HEATER_MIRROR_FAN bypasses this). */
static void serviceHeatersForSession(bool dhtOk, float airC) {
  if (!dryingSessionOutputsActive()) {
    driveHeaterLoad(false);
    return;
  }
  const bool heatOn = heaterDemandVsTarget(dhtOk, airC);
  driveHeaterLoad(heatOn);
  static unsigned long lastHeaterLogMs = 0;
  const unsigned long now = millis();
  if (lastHeaterLogMs == 0 || (now - lastHeaterLogMs) > 8000UL) {
    lastHeaterLogMs = now;
    const float t = airCToUseForHeater(dhtOk, airC);
    Serial.print("[heater] thermostat on=");
    Serial.print(heatOn ? 1 : 0);
    Serial.print(" airC=");
    if (isnan(t)) Serial.print("nan");
    else Serial.print(t, 1);
    Serial.print(" targetC=");
    Serial.print(gSessionTargetC, 1);
    Serial.print(" cmdOn=");
    Serial.print(sHeaterCommandedOn ? 1 : 0);
    Serial.print(" gpio19=");
    Serial.println(digitalRead(RELAY_HEATER1));
  }
}

static void logActualLoadGpios(const char* why) {
  Serial.print("[gpio] ");
  Serial.print(why);
  Serial.print(" fanGPIO");
  Serial.print(RELAY_FAN);
  Serial.print("=");
  Serial.print(fanLoadIsOn() ? 1 : 0);
  Serial.print(" h1=");
  Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
  Serial.print(" h2=");
  Serial.print(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);
  Serial.print(" buzz=");
  Serial.print(gBuzzerTonePlaying || gBuzzerHwPwmOn ? 1 : 0);
  Serial.print(" ACTIVE_LOW=");
  Serial.println(RELAY_ACTIVE_LOW ? 1 : 0);
}

static void disengageBuzzerAlarm() {
  gBuzzerAlarmEngaged = false;
  gBuzzerCycleAnchorMs = 0;
  buzzerForceSilent();
}

static void engageBuzzerAlarm(unsigned long nowMs) {
  if (!gBuzzerAlarmEngaged) {
    gBuzzerAlarmEngaged = true;
    gBuzzerCycleAnchorMs = nowMs;
    Serial.println("[buzzer] fault — LOUD 10s ON / 10s quiet until fixed");
  }
}

/** Machine id for machines/{id}/session — assignment, MAC scan, then optional fallback. */
static int effectiveSessionMachineId() {
  if (gAssignedId > 0) {
    return gAssignedId;
  }
  static int sMacScannedId = 0;
  static unsigned long sLastMacScanMs = 0;
  const unsigned long now = millis();
  if (sMacScannedId <= 0 &&
      (sLastMacScanMs == 0 || (now - sLastMacScanMs) > 8000UL)) {
    sLastMacScanMs = now;
    sMacScannedId = findMachineIdForMacInMachinesJson();
  }
  if (sMacScannedId > 0) {
    return sMacScannedId;
  }
#if FALLBACK_MACHINE_ID > 0
  return FALLBACK_MACHINE_ID;
#else
  return 0;
#endif
}

/** Log GPIO levels for fan + SSR (proves MCU is driving OFF). */
static void logLoadPinLevels(const char* why) {
  Serial.print("[gpio] ");
  Serial.print(why);
  Serial.print(" session=");
  Serial.print(gSessionStatus);
  Serial.print(" fanGPIO");
  Serial.print(RELAY_FAN);
  Serial.print("=");
  Serial.print(digitalRead(RELAY_FAN));
  Serial.print(FAN_RELAY_ACTIVE_LOW ? "(LOW=ON)" : "(HIGH=ON)");
  Serial.print(" h1GPIO");
  Serial.print(RELAY_HEATER1);
  Serial.print("=");
  Serial.print(digitalRead(RELAY_HEATER1));
#if HEATER_CONTROL_IS_SSR && HEATER_SSR_SINK_5V
  Serial.print("(LOW=run)");
#elif HEATER_CONTROL_IS_SSR && HEATER_SSR_ACTIVE_LOW
  Serial.print("(LOW=run)");
#elif HEATER_CONTROL_IS_SSR
  Serial.print("(HIGH=run)");
#endif
  Serial.print(" h2GPIO");
  Serial.print(RELAY_HEATER2);
  Serial.print("=");
  Serial.println(digitalRead(RELAY_HEATER2));
}

/** Force fan + heater control pins to OFF before WiFi / session logic. */
static void initLoadPinsForcedOff() {
#if ENABLE_RTDB_HARDWARE_TEST
  if (hardwareTestActive()) {
    holdHardwareTestActuators();
    return;
  }
#endif
  driveFanLoad(false);
  driveHeaterLoad(false);
}

static void loadsHardwareAllOff() {
  driveFanLoad(false);
  driveHeaterLoad(false);
}

static void logWhyLoadsBlocked() {
  static unsigned long lastMs = 0;
  const unsigned long now = millis();
  if (lastMs != 0 && (now - lastMs) < 10000UL) return;
  lastMs = now;
  Serial.print("[loads] BLOCKED id=");
  Serial.print(gAssignedId);
  Serial.print(" status=");
  Serial.print(gSessionStatus);
  Serial.print(" active=");
  Serial.print(gSessionActiveFlag ? 1 : 0);
  Serial.print(" targetC=");
  Serial.println(gSessionTargetC, 1);
}

/** Fan + heaters OFF immediately. Re-write pins every call — no float/kick delays. */
static void forceActuatorsOff() {
  sFanNeedWakePulse = false;
  driveFanLoad(false);
  driveHeaterLoad(false);
  sHeaterThermostatOn = false;
  static unsigned long lastLogMs = 0;
  const unsigned long now = millis();
  if (lastLogMs == 0 || (now - lastLogMs) > 5000UL) {
    lastLogMs = now;
    logLoadPinLevels("FORCE-OFF");
  }
}

static void beginDryingOutputs(bool chirp) {
  gLocalHmiOwned = true;
  if (gLocalOfflineId.length() == 0) {
    gLocalOfflineId = newLocalOfflineId();
  }
  gHoldPowerResume = false;
  gDryRunAuthorized = true;
  gLastAppliedCommandAction = "start";
  clearHeaterTempMemory();
  if (gDryingSessionStartMs == 0) {
    gDryingSessionStartMs = millis();
  }
  gSessionStatus = "running";
  gSessionActiveFlag = true;
  gFaultBuzzerArmed = true;
  gMoistureCheckArmed = false;
  gDryingOutputsLatched = true;
  if (gSessionTargetC <= 1.0f) {
    gSessionTargetC = 60.0f;
  }
  applyLedsForSession("running");
  remainArm();
  if (chirp) {
  #if BUZZER_DRYING_START_CHIRP_MS > 0
    Serial.println("[buzzer] drying-start");
    buzzerChirpLoudBlocking((unsigned long)BUZZER_DRYING_START_CHIRP_MS);
  #endif
  }
  latchDoorOpenBuzzerPolicyAtSessionStart();
  forceFanRelayWakeOn();
  {
    const bool dhtOkNow = pollDhtIfDue();
    applyDryingSessionLoads(dhtOkNow, cachedDhtT);
  }
  driveFanLoad(true);
  logActuatorState("drying-on");
  logActualLoadGpios("drying");
  persistActiveSession();
}

/** Fan + heaters ON (bench / wiring test — not session PWM). */
static void applyDryingOutputsHard() {
  driveFanLoad(true);
  driveHeaterLoad(true);
}

/** Session loads: fan speed PWM + target-temp heaters (Overview Start only). */
static void applyDryingSessionLoads(bool dhtOk, float airC) {
  serviceFanSpeedRelay(millis());
  serviceHeatersForSession(dhtOk, airC);
}

static void safetyCutLoadsUnlessRunning() {
  if (dryingSessionOutputsActive()) {
    return;
  }
#if ENABLE_RTDB_HARDWARE_TEST
  if (hardwareTestActive()) {
    holdHardwareTestActuators();
    return;
  }
#endif
  driveFanLoad(false);
  driveHeaterLoad(false);
}

static void updateBuzzerFaultLatch(bool dhtOk, bool moistureOk, bool doorOk, bool doorOpen, float airC) {
  static bool sLoggedFault = false;
  (void)moistureOk;
  if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
    disengageBuzzerAlarm();
    sLoggedFault = false;
    gLowTempBuzzWindowLogged = 0xFFFFFFFFUL;
    setDryingProblemLine("None");
    return;
  }
  const bool sensorFault = sensorsBadForBuzzer(dhtOk, moistureOk, doorOk);
  const bool tempHigh = tempHighForBuzzer(dhtOk, airC);
  const bool tempLow = tempLowAfterWarmup(dhtOk, airC);
  const bool doorOpenFault = doorOpenedDuringDryingFault(doorOk, doorOpen);
  const bool doorShown = doorOk && doorOpen;
  if (!dhtOk && doorShown) setDryingProblemLine("No DHT22+Door");
  else if (!dhtOk) setDryingProblemLine("No DHT22");
  else if (doorShown && tempHigh) setDryingProblemLine("High+Door");
  else if (doorShown && tempLow) setDryingProblemLine("Low temp+Door");
  else if (doorShown) setDryingProblemLine("Door open");
  else if (tempHigh) setDryingProblemLine("Temp high");
  else if (tempLow) setDryingProblemLine("Low temp");
#if HAVE_DOOR_SENSOR
  else if (!doorOk) setDryingProblemLine("Door sensor");
#endif
  else setDryingProblemLine("None");

  const bool urgent = sensorFault || tempHigh || doorOpenFault;
  if (urgent) {
    if (!sLoggedFault) {
      sLoggedFault = true;
      Serial.print("[buzzer] DRYING FAULT sensor=");
      Serial.print(sensorFault ? 1 : 0);
      Serial.print(" high=");
      Serial.print(tempHigh ? 1 : 0);
      Serial.print(" low=");
      Serial.print(tempLow ? 1 : 0);
      Serial.print(" doorOpen=");
      Serial.print(doorOpenFault ? 1 : 0);
      Serial.print(" dht=");
      Serial.print(dhtOk ? 1 : 0);
      Serial.print(" airC=");
      Serial.print(airC, 1);
      Serial.print(" target=");
      Serial.println(gSessionTargetC, 1);
    }
    engageBuzzerAlarm(millis());
    return;
  }
  sLoggedFault = false;
  if (gBuzzerAlarmEngaged) {
    disengageBuzzerAlarm();
  }
}

/** 10s beep / 10s silent from anchor — not one toggle per loop (HTTP can block minutes). */
static void applyBuzzerCycleFromClock(unsigned long nowMs) {
  if (!gBuzzerAlarmEngaged || gBuzzerCycleAnchorMs == 0) return;
  const unsigned long cycleMs = ALERT_BUZZ_ON_MS + ALERT_BUZZ_SILENT_MS;
  const unsigned long pos = (nowMs - gBuzzerCycleAnchorMs) % cycleMs;
  if (pos < ALERT_BUZZ_ON_MS) {
    buzzerDriveLoud();
  } else if (gBuzzerHwPwmOn || gBuzzerTonePlaying) {
    buzzerForceSilent();
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
  }
  noTone(BUZZER_PIN);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  gBuzzerTonePlaying = false;
  gBuzzerPinHigh = false;
}

/** GPIO17 HIGH = on (active buzzer with 220Ω). */
static void buzzerDriveLoud() {
#if BUZZER_ACTIVE_HIGH
  if (gBuzzerHwPwmOn) {
    ledcWrite(BUZZER_PIN, 0);
    ledcDetach(BUZZER_PIN);
    gBuzzerHwPwmOn = false;
  }
  noTone(BUZZER_PIN);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);
  gBuzzerTonePlaying = true;
  gBuzzerPinHigh = true;
#else
  pinMode(BUZZER_PIN, OUTPUT);
  const uint32_t halfUs = 500000UL / (uint32_t)BUZZER_TONE_HZ;
  const uint32_t now = micros();
  if ((uint32_t)(now - gBuzzerLastToggleUs) >= halfUs) {
    gBuzzerLastToggleUs = now;
    gBuzzerPinLevel = !gBuzzerPinLevel;
    digitalWrite(BUZZER_PIN, gBuzzerPinLevel ? HIGH : LOW);
  }
  gBuzzerTonePlaying = true;
#endif
}

static void buzzerHwStart() {
  buzzerDriveLoud();
}

static void buzzerTickSquareWave() {
  buzzerDriveLoud();
}

/** Loud blocking chirp (drying start). */
static void buzzerChirpLoudBlocking(unsigned long ms) {
  if (ms == 0) return;
  const unsigned long end = millis() + ms;
  while ((long)(end - millis()) > 0) {
    buzzerDriveLoud();
    delayMicroseconds(50);
    yield();
  }
  buzzerForceSilent();
}

/** Hardware tests: PWM + square wave so passive piezos actually sound. */
static void buzzerTestDrive() {
  #if BUZZER_ACTIVE_HIGH
  buzzerHwStart();
  #else
  buzzerHwStart();
  buzzerTickSquareWave();
  #endif
}

static void buzzerAlarmBlockingSeconds(int sec) {
  if (sec <= 0) return;
  Serial.print("[buzzer] boot test ");
  Serial.print(sec);
  Serial.println(" s");
  const unsigned long endMs = millis() + (unsigned long)sec * 1000UL;
  while ((long)(endMs - millis()) > 0) {
    buzzerTestDrive();
    delay(2);
  }
  buzzerForceSilent();
}

static void serviceBuzzer(bool dhtOk, bool moistureOk, bool doorOk, bool doorOpen, float airC) {
  const unsigned long now = millis();
  updateBuzzerFaultLatch(dhtOk, moistureOk, doorOk, doorOpen, airC);

  if (hardwareTestActive()) {
    disengageBuzzerAlarm();
    // Test tick owns the pin — do not silence here (that made Test Buzzer mute).
    return;
  }

  if (gBuzzerAlarmEngaged) {
    applyBuzzerCycleFromClock(now);
    return;
  }

  const bool lowBuzz = tempLowAfterWarmup(dhtOk, airC) &&
                       lowTempBuzzWindowOpen(dryingRunElapsedMs());
  if (lowBuzz) {
    const unsigned long elapsed = dryingRunElapsedMs();
    const unsigned long window =
        (elapsed - TEMP_BELOW_TARGET_AFTER_DRYING_MS) / TEMP_LOW_BUZZ_EVERY_MS;
    if (window != gLowTempBuzzWindowLogged) {
      gLowTempBuzzWindowLogged = window;
      Serial.println("[buzzer] low temp — on 3 min, then quiet until the next 10 min");
    }
    buzzerDriveLoud();
    return;
  }
  if (gBuzzerTonePlaying || gBuzzerHwPwmOn) buzzerForceSilent();
}

static unsigned long gLastWifiAttemptMs = 0;

void connectWifiBlocking(uint32_t timeoutMs = 15000) {
  if (WiFi.status() == WL_CONNECTED) return;

  const unsigned long now = millis();
  if (gLastWifiAttemptMs != 0 && timeoutMs <= 4000 &&
      (now - gLastWifiAttemptMs) < 2500UL) {
    return;
  }
  gLastWifiAttemptMs = now;

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
#if defined(ESP32)
  esp_wifi_set_ps(WIFI_PS_NONE);
#endif
  WiFi.setAutoReconnect(true);
  if (WiFi.SSID().length() == 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  } else {
    WiFi.reconnect();
  }

  Serial.print("Connecting WiFi");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(250);
    yield();
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
      delay(250);
      yield();
      Serial.print(".");
    }
    Serial.println();
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi not connected.");
  }
}

static void connectWifiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) {
    if (gWifiWasDown) {
      gWifiWasDown = false;
      gNeedStatePublish = true;
      lastHeartbeatMs = 0;
      gLastLanPollMs = 0;
      Serial.println("[wifi] back online — republish session + heartbeat");
    }
    return;
  }
  gWifiWasDown = true;
  const unsigned long now = millis();
  if (gLastWifiAttemptMs != 0 && (now - gLastWifiAttemptMs) < 8000UL) {
    return;
  }
  gLastWifiAttemptMs = now;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
#if defined(ESP32)
  esp_wifi_set_ps(WIFI_PS_NONE);
#endif
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.println("[wifi] reconnect attempt");
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

static String parseJsonQuotedAfterKey(const String& body, const char* key) {
  const String k = String("\"") + key + "\"";
  const int p = body.indexOf(k);
  if (p < 0) return String();
  const int colon = body.indexOf(':', p);
  if (colon < 0) return String();
  int q1 = body.indexOf('"', colon + 1);
  if (q1 < 0) return String();
  int q2 = q1 + 1;
  while (q2 < (int)body.length() && body[q2] != '"') {
    if (body[q2] == '\\' && q2 + 1 < (int)body.length()) q2 += 2;
    else q2++;
  }
  if (q2 >= (int)body.length()) return String();
  return body.substring(q1 + 1, q2);
}

static void appendRtdbAuthQuery(String& url) {
  // Database secret is short. JWT ID tokens must NOT go in the URL — ESP32 HTTPClient
  // truncates / fails begin() and Firebase never gets the PUT.
  if (strlen(FIREBASE_DB_SECRET) == 0) return;
  url += (url.indexOf('?') >= 0) ? "&" : "?";
  url += "auth=";
  url += FIREBASE_DB_SECRET;
}

static WiFiClientSecure gRtdbTls;
static bool gRtdbTlsReady = false;
static String gRtdbHost;
static unsigned long gLastRtdbFailLogMs = 0;

static void rtdbTlsPrepare() {
  if (!gRtdbTlsReady) {
    gRtdbTls.setInsecure();
    // Handshake only runs when the keep-alive socket is down, not on every poll.
    gRtdbTls.setHandshakeTimeout(3);
    gRtdbTlsReady = true;
  }
  // Default TCP connect can sit for a minute. That gap is what flipped Offline.
  gRtdbTls.setTimeout(3);
  if (gRtdbHost.length() == 0) {
    String u = FIREBASE_DATABASE_URL;
    if (u.startsWith("https://")) u = u.substring(8);
    else if (u.startsWith("http://")) u = u.substring(7);
    const int slash = u.indexOf('/');
    if (slash > 0) u = u.substring(0, slash);
    gRtdbHost = u;
  }
}

static void rtdbTlsStop() {
  gRtdbTls.stop();
}

static void rtdbLogFail(const char* what, int code, const String& path) {
  const unsigned long now = millis();
  if (gLastRtdbFailLogMs != 0 && (now - gLastRtdbFailLogMs) < 8000UL) return;
  gLastRtdbFailLogMs = now;
  Serial.print("[RTDB] ");
  Serial.print(what);
  Serial.print(" ");
  Serial.print(code);
  Serial.print(" ");
  Serial.println(path);
}

/** Byte from the keep-alive socket, or -1 on deadline / disconnect. */
static int rtdbReadByte(unsigned long deadline) {
  unsigned long lastKeyMs = 0;
  while ((long)(deadline - millis()) > 0) {
    if (gRtdbTls.available()) return gRtdbTls.read();
    if (!gRtdbTls.connected()) return -1;
    const unsigned long now = millis();
    if (lastKeyMs == 0 || (now - lastKeyMs) >= 20UL) {
      lastKeyMs = now;
      serviceLocalHmiKeys();
    }
    delay(1);
  }
  return -1;
}

static bool rtdbReadLine(String& line, unsigned long deadline) {
  line = "";
  while ((long)(deadline - millis()) > 0) {
    const int c = rtdbReadByte(deadline);
    if (c < 0) return false;
    if (c == '\n') return true;
    if (c != '\r' && line.length() < 220) line += (char)c;
  }
  return false;
}

static bool rtdbReadChunked(String& body, unsigned long deadline) {
  body = "";
  while (body.length() < 4096 && (long)(deadline - millis()) > 0) {
    String szLine;
    if (!rtdbReadLine(szLine, deadline)) return false;
    szLine.trim();
    const int semi = szLine.indexOf(';');
    if (semi >= 0) szLine = szLine.substring(0, semi);
    const long n = strtol(szLine.c_str(), nullptr, 16);
    if (n <= 0) {
      String trailer;
      (void)rtdbReadLine(trailer, deadline);
      return true;
    }
    if (body.length() + (unsigned)n > 4096) return false;
    body.reserve(body.length() + (unsigned)n);
    for (long i = 0; i < n; i++) {
      const int c = rtdbReadByte(deadline);
      if (c < 0) return false;
      body += (char)c;
    }
    (void)rtdbReadByte(deadline);
    (void)rtdbReadByte(deadline);
  }
  return body.length() < 4096;
}

/**
 * One HTTPS request on a reused TLS socket.
 * A fresh handshake is the slow part (about 1–2 s). Polls after that are one round trip.
 */
static int rtdbHttp(const char* method, const String& pathNoJsonSuffix,
                    const String* jsonBody, String* respBody, unsigned long timeoutMs) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  rtdbTlsPrepare();
  if (gRtdbHost.length() == 0) return -1;

  const unsigned long budget = timeoutMs > 0 ? timeoutMs : 1200UL;
  String path = "/";
  path += pathNoJsonSuffix;
  if (!path.endsWith(".json")) path += ".json";
  appendRtdbAuthQuery(path);

  String req;
  req.reserve(180 + path.length() + (jsonBody ? jsonBody->length() : 0));
  req += method;
  req += ' ';
  req += path;
  req += " HTTP/1.1\r\nHost: ";
  req += gRtdbHost;
  req += "\r\nConnection: keep-alive\r\nUser-Agent: fish-dryer-esp\r\nAccept: application/json\r\n";
  if (jsonBody) {
    req += "Content-Type: application/json\r\nContent-Length: ";
    req += String(jsonBody->length());
    req += "\r\n";
  }
  req += "\r\n";
  if (jsonBody) req += *jsonBody;

  // One reconnect if the kept socket is dead. Do not handshake twice when Wi-Fi is down.
  for (int attempt = 0; attempt < 2; attempt++) {
    if (!gRtdbTls.connected()) {
      // stop() clears the TLS client on some ESP32 cores — set this every connect.
      // 3s was shorter than the first handshake on the phone hotspot, so a new
      // board never wrote discovery/{MAC} and Add Machine could not see it.
      gRtdbTls.setInsecure();
      gRtdbTls.setHandshakeTimeout(15);
      gRtdbTls.setTimeout(15);
      if (!gRtdbTls.connect(gRtdbHost.c_str(), 443)) {
        rtdbTlsStop();
        return -1;
      }
      gRtdbTls.setTimeout(3);
    }

    if (gRtdbTls.print(req) != (int)req.length()) {
      rtdbTlsStop();
      if (attempt == 0) continue;
      return -1;
    }

    const unsigned long deadline = millis() + budget;
    String status;
    if (!rtdbReadLine(status, deadline)) {
      rtdbTlsStop();
      if (attempt == 0) continue;
      return -1;
    }
    int code = -1;
    if (status.startsWith("HTTP/1.")) {
      const int sp = status.indexOf(' ');
      if (sp > 0) code = status.substring(sp + 1).toInt();
    }
    if (code < 100) {
      rtdbTlsStop();
      if (attempt == 0) continue;
      return -1;
    }

    int contentLength = -1;
    bool chunked = false;
    bool connClose = false;
    bool headersOk = false;
    while ((long)(deadline - millis()) > 0) {
      String h;
      if (!rtdbReadLine(h, deadline)) break;
      if (h.length() == 0) {
        headersOk = true;
        break;
      }
      String hl = h;
      hl.toLowerCase();
      if (hl.startsWith("content-length:")) {
        contentLength = hl.substring(15).toInt();
      } else if (hl.startsWith("transfer-encoding:") && hl.indexOf("chunked") >= 0) {
        chunked = true;
      } else if (hl.startsWith("connection:") && hl.indexOf("close") >= 0) {
        connClose = true;
      }
    }
    if (!headersOk) {
      rtdbTlsStop();
      if (attempt == 0) continue;
      return -1;
    }

    String body;
    bool bodyOk = true;
    if (chunked) {
      bodyOk = rtdbReadChunked(body, deadline);
    } else if (contentLength > 4096) {
      bodyOk = false;
    } else if (contentLength > 0) {
      body.reserve((unsigned)contentLength);
      for (int i = 0; i < contentLength; i++) {
        const int c = rtdbReadByte(deadline);
        if (c < 0) {
          bodyOk = false;
          break;
        }
        body += (char)c;
      }
    }
    if (!bodyOk) {
      rtdbTlsStop();
      if (attempt == 0) continue;
      return -1;
    }
    if (connClose) rtdbTlsStop();
    if (respBody) *respBody = body;
    return code;
  }
  return -1;
}

static String rtdbGetText(const String& pathNoJsonSuffix, unsigned long timeoutMs = 0) {
  serviceLocalHmiKeys();
  if (WiFi.status() != WL_CONNECTED) return String();
  String body;
  const unsigned long budget = timeoutMs > 0 ? timeoutMs : RTDB_GET_TIMEOUT_MS;
  const int code = rtdbHttp("GET", pathNoJsonSuffix, nullptr, &body, budget);
  serviceLocalHmiKeys();
  if (code >= 200 && code < 300) return body;
  rtdbLogFail("GET", code, pathNoJsonSuffix);
  return String();
}

/** Initialize MAC-based identity; load any persisted assignment from NVS. */
static void initIdentity() {
  gDeviceMac = WiFi.macAddress();
  gDeviceMacSafe = gDeviceMac;
  gDeviceMacSafe.replace(":", "");
  gDeviceMacSafe.toUpperCase();
  // Friendly default name: "Fish Dryer ABCD" using last 4 hex of MAC.
  const String tail = gDeviceMacSafe.substring(gDeviceMacSafe.length() - 4);
  gHardwareDeviceId = String("Fish Dryer ") + tail;
  gDeviceName = gHardwareDeviceId;

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

/** Set when assignments/{this MAC} names this id. Stops a copied NVS id from publishing. */
static int gAssignmentConfirmedId = 0;

static String macKeyFromRtdbString(String body) {
  body.trim();
  body.replace("\"", "");
  body.replace(":", "");
  body.toUpperCase();
  String out;
  out.reserve(12);
  for (unsigned i = 0; i < body.length(); i++) {
    const char c = body[i];
    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')) out += c;
  }
  return out;
}

/**
 * Numeric id this physical board may write.
 * assignments/{MAC} wins. A leftover NVS id is used only when
 * machines/{id}/hardware_status/mac is empty or already this MAC.
 * Another board's MAC means we drop the id so we stop overwriting its sensors.
 */
static int ownedPublishId(bool allowNetworkCheck) {
  if (gAssignedId <= 0) return 0;
  if (gAssignmentConfirmedId == gAssignedId) return gAssignedId;

  static int sCheckedId = 0;
  static unsigned long sCheckedMs = 0;
  static bool sCheckedOk = false;
  const unsigned long now = millis();
  if (sCheckedId == gAssignedId && (now - sCheckedMs) < 20000UL) {
    return sCheckedOk ? gAssignedId : 0;
  }
  if (!allowNetworkCheck) {
    return (sCheckedId == gAssignedId && sCheckedOk) ? gAssignedId : 0;
  }

  const String body = rtdbGetText(
      String("machines/") + String(gAssignedId) + "/hardware_status/mac", 1200UL);
  if (body.length() == 0) {
    // GET failed. Do not cache that, and do not steal the slot.
    return 0;
  }
  sCheckedMs = now;
  sCheckedId = gAssignedId;
  const String key = macKeyFromRtdbString(body);
  if (key.length() < 12 || key == "NULL") {
    sCheckedOk = true;
    return gAssignedId;
  }
  String mine = gDeviceMacSafe;
  mine.toUpperCase();
  const bool mineOwns = mine.length() >= 12 && key.substring(0, 12) == mine.substring(0, 12);
  sCheckedOk = mineOwns;
  if (!mineOwns) {
    Serial.print("[assignment] id ");
    Serial.print(gAssignedId);
    Serial.println(" belongs to another MAC — not sharing its component status");
    gAssignedId = 0;
    gAssignmentConfirmedId = 0;
    persistAssignment(0, gDeviceName);
    sCheckedId = 0;
    sCheckedOk = false;
    return 0;
  }
  return gAssignedId;
}

/**
 * If assignments/{MAC} is missing, find machines/{id}/hardware_status whose mac matches
 * this board (same path the mobile app listens on).
 */
static int findMachineIdForMacInMachinesJson() {
  // Do not GET the entire machines/ tree — that JSON can be huge and crashes the ESP32.
  return 0;
}

/** Read assignments/{macSafe} from RTDB and adopt any new ID/name. Returns true if updated. */
static bool refreshAssignmentFromCloud() {
  String body = rtdbGetText(String("assignments/") + gDeviceMacSafe);
  if (body.length() == 0 || body == "null") {
    String macLower = gDeviceMacSafe;
    macLower.toLowerCase();
    const String alt = rtdbGetText(String("assignments/") + macLower);
    if (alt.length() > 0 && alt != "null") {
      body = alt;
    }
  }
  bool haveAssignment = (body.length() > 0 && body != "null");

  // Cheap JSON pick — avoids pulling ArduinoJson for two fields.
  int newId = gAssignedId;
  String newName = gDeviceName;
  bool parsedFromBody = false;
  const int idKey = body.indexOf("\"microcontroller_id\"");
  if (idKey >= 0) {
    int colon = body.indexOf(':', idKey);
    if (colon > 0) {
      int end = colon + 1;
      while (end < (int)body.length() && (body[end] == ' ' || body[end] == '\t')) end++;
      int numStart = end;
      while (end < (int)body.length() && (isdigit(body[end]) || body[end] == '-')) end++;
      if (end > numStart) {
        newId = body.substring(numStart, end).toInt();
        parsedFromBody = true;
      }
    }
  }
  // Plain numeric body (e.g. "5") is also accepted.
  if (idKey < 0) {
    String trimmed = body;
    trimmed.trim();
    if (trimmed.length() > 0 && (isdigit(trimmed[0]) || trimmed[0] == '-')) {
      newId = trimmed.toInt();
      parsedFromBody = true;
    }
  }
  if (haveAssignment) {
    const int nameKey = body.indexOf("\"name\"");
    if (nameKey >= 0) {
      int colon = body.indexOf(':', nameKey);
      int q1 = body.indexOf('"', colon + 1);
      int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
      if (q1 >= 0 && q2 > q1) newName = body.substring(q1 + 1, q2);
    }
  }

  if (haveAssignment && parsedFromBody && newId > 0) {
    gAssignmentConfirmedId = newId;
  }

  if (newId <= 0) {
    const int scanned = findMachineIdForMacInMachinesJson();
    if (scanned > 0) {
      newId = scanned;
      Serial.print("[assignment] MAC match in machines/ -> id=");
      Serial.println(newId);
      String assignJson = "{\"microcontroller_id\":";
      assignJson += String(newId);
      assignJson += ",\"mac\":\"";
      assignJson += gDeviceMac;
      assignJson += "\"}";
      (void)rtdbPutJson(String("assignments/") + gDeviceMacSafe, assignJson);
    }
  }

  const bool changed = (newId != gAssignedId) || (newName.length() > 0 && newName != gDeviceName);
  if (changed) {
    if (newId != gAssignedId) {
      Serial.printf("[assignment] id changed %d -> %d\n", gAssignedId, newId);
    }
    gAssignedId = newId;
    if (newName.length() > 0) gDeviceName = newName;
    persistAssignment(gAssignedId, gDeviceName);
    consumeCloudCommandSeq(gAssignedId);
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

static String laravelStatusUrl() {
  if (gLaravelApiBase.length() == 0) return String();
  return gLaravelApiBase + "/hardware/esp32/status";
}

static String laravelSessionUrl() {
  if (gLaravelApiBase.length() == 0) return String();
  return gLaravelApiBase + "/hardware/esp32/session";
}

static void refreshLaravelBaseFromRtdb() {
  if (LocalHmi::blockNetworkForKey()) return;
  const String body = rtdbGetText("lan/server");
  if (body.length() == 0 || body == "null") return;
  String api = parseJsonQuotedAfterKey(body, "api_base_url");
  if (api.length() == 0) {
    const String host = parseJsonQuotedAfterKey(body, "host");
    const int port = parseJsonIntAfterKey(body, "port", 8000);
    if (host.length() > 0) {
      api = "http://";
      api += host;
      api += ":";
      api += String(port);
      api += "/api";
    }
  }
  api.trim();
  while (api.endsWith("/")) api.remove(api.length() - 1);
  if (api.length() == 0) return;
  if (api != gLaravelApiBase) {
    gLaravelApiBase = api;
    gPrefs.begin("fdhmi", false);
    gPrefs.putString("api", api);
    gPrefs.end();
    Serial.print("[lan] Laravel API ");
    Serial.println(gLaravelApiBase);
  }
}

static void enterPausedSession() {
  remainFreeze();
  if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
    gLocalRunAccumMs += (millis() - gLocalRunSegmentStartMs);
    gLocalRunSegmentStartMs = 0;
  }
  gDryRunAuthorized = false;
  gDryingOutputsLatched = false;
  gSessionStatus = "paused";
  gSessionActiveFlag = false;
  gFaultBuzzerArmed = false;
  gDryingSessionStartMs = 0;
  clearHeaterTempMemory();
  resetDoorOpenBuzzerPolicy();
  disengageBuzzerAlarm();
  forceActuatorsOff();
  applyLedsForSession("paused");
  persistActiveSession();
  Serial.println("[session] PAUSED — fan/heaters/buzzer OFF");
}

static void applySessionParamsFromBody(const String& body) {
  const float tt = parseJsonFloatAfterKey(body, "target_temperature", gSessionTargetC);
  if (tt > 1.0f && tt < 120.0f) {
    gSessionTargetC = tt;
  }
  const int fs = parseJsonIntAfterKey(body, "fan_speed", gFanSpeedLevel);
  gFanSpeedLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);

  String fish = parseJsonStringAfterKey(body, "fish_type", "");
  fish.trim();
  if (fish.length() > 0) {
    gLocalFishType = fish;
  }
  const int qty = parseJsonIntAfterKey(body, "total_fish", -1);
  if (qty >= 0) {
    gLocalTotalFish = qty;
  }
  const int remSec = parseJsonIntAfterKey(body, "remaining_sec", -1);
  if (remSec >= 0 && !sessionStatusIsRunning()) {
    remainSet(remSec);
    gLocalDurationSec = remSec < 1 ? 1 : remSec;
    gLocalDurationMin = (gLocalDurationSec + 59) / 60;
  } else {
    const int dm = parseJsonIntAfterKey(body, "set_duration_minutes", 0);
    if (dm > 0 && !sessionStatusIsRunning() && !sessionStatusIsPaused()) {
      gLocalDurationMin = dm;
      gLocalDurationSec = dm * 60;
      remainSet(gLocalDurationSec);
    }
  }
}

static String parseSessionStatusFromBody(const String& body) {
  String trimmed = body;
  trimmed.trim();
  if (trimmed.length() > 0 && trimmed != "null") {
    const int sq = trimmed.indexOf("\"status\"");
    if (sq >= 0) {
      const int colon = trimmed.indexOf(':', sq);
      const int q1 = trimmed.indexOf('"', colon + 1);
      const int q2 = q1 >= 0 ? trimmed.indexOf('"', q1 + 1) : -1;
      if (q1 >= 0 && q2 > q1) {
        String status = trimmed.substring(q1 + 1, q2);
        status.toLowerCase();
        status.trim();
        if (status.length() > 0) {
          return status;
        }
      }
    }
  }
  return String("stopped");
}

static void commitLoadRelays(bool dhtOk, float airC) {
  if (dryingSessionOutputsActive()) {
    applyDryingSessionLoads(dhtOk, airC);
    return;
  }
#if ENABLE_RTDB_HARDWARE_TEST
  if (hardwareTestActive()) {
    holdHardwareTestActuators();
    return;
  }
#endif
  initLoadPinsForcedOff();
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

static void publishSessionStoppedToCloud(int mid) {
  if (mid <= 0) return;
  const String path = String("machines/") + String(mid) + "/session";
  const String json =
      "{\"status\":\"stopped\",\"command\":\"stop\",\"session_active\":false,"
      "\"target_temperature\":0,\"fan_speed\":1}";
  (void)rtdbPutJson(path, json);
  const String cmdPath = String("machines/") + String(mid) + "/command";
  const String cmdJson =
      "{\"action\":\"stop\",\"target_temperature\":0,\"fan_speed\":1,"
      "\"seq\":" + String((unsigned long)millis()) + "}";
  (void)rtdbPutJson(cmdPath, cmdJson);
}

/** Mark cloud command seq as seen so an old `start` cannot energize loads after boot. */
static void consumeCloudCommandSeq(int mid) {
  if (mid <= 0) return;
  const String body = rtdbGetText(String("machines/") + String(mid) + "/command");
  if (body.length() == 0 || body == "null") return;
  const unsigned long seq =
      (unsigned long)parseJsonFloatAfterKey(body, "seq", 0);
  if (seq > gLastCommandSeq) {
    gLastCommandSeq = seq;
  }
  String action = parseJsonStringAfterKey(body, "action", "");
  action.toLowerCase();
  action.trim();
  if (action.length() > 0) {
    gLastAppliedCommandAction = action;
  }
  gLastCommandUpdated = parseJsonStringAfterKey(body, "updated_at", "");
}

static void forceIdleSessionState() {
  remainFreeze();
  remainSet(0);
  gDeferredRtdbStatus = "";
  gDryRunAuthorized = false;
  gDryingOutputsLatched = false;
  gSessionStatus = "stopped";
  gLastAppliedCommandAction = "stop";
  gFaultBuzzerArmed = false;
  gMoistureCheckArmed = false;
  gSessionActiveFlag = false;
  gSessionTargetC = 0.0f;
  gNullSessionPollStreak = 0;
  gDrySessionLatched = false;
  gDryingSessionStartMs = 0;
  gLocalHmiOwned = false;
  gLocalRunAccumMs = 0;
  gLocalRunSegmentStartMs = 0;
  clearHeaterTempMemory();
  resetDoorOpenBuzzerPolicy();
  disengageBuzzerAlarm();
  pauseLocalHardwareTestOnly();
  forceActuatorsOff();
  applyLedsForSession("stopped");
  gHoldPowerResume = false;
  if (gSessionPersistEnabled) clearPersistedSession();
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
  Serial.print(fanLoadIsOn() ? 1 : 0);
  Serial.print(" h1=");
  Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
  Serial.print(" h2=");
  Serial.print(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);
  Serial.print(" RELAY_ACTIVE_LOW=");
  Serial.println(RELAY_ACTIVE_LOW ? 1 : 0);
}

/** Prefer persisted assignment id — must match mobile `machines/{id}/session` + `command`. */
static int sessionMachineId() {
  if (gAssignedId <= 0) return 0;
  if (gAssignmentConfirmedId == gAssignedId) return gAssignedId;
  return ownedPublishId(false);
}

/**
 * Mobile + Laravel write `machines/{id}/command` — ESP applies this first (reliable).
 */
static void applyCloudCommandFromRtdb(int mid, unsigned long timeoutMs = 0) {
  if (mid <= 0) {
    return;
  }
  const String path = String("machines/") + String(mid) + "/command";
  const String body = rtdbGetText(path, timeoutMs);
  if (body.length() == 0 || body == "null") {
    return;
  }

  const unsigned long seq =
      (unsigned long)parseJsonFloatAfterKey(body, "seq", 0);

  String action = parseJsonStringAfterKey(body, "action", "");
  action.toLowerCase();
  action.trim();
  if (action.length() == 0) {
    action = parseJsonStringAfterKey(body, "command", "");
    action.toLowerCase();
    action.trim();
  }

  const String updatedAt = parseJsonStringAfterKey(body, "updated_at", "");
  // A keypad Start must not be undone by the command that was already in RTDB,
  // or by the app's "time is up" pause that sends remaining_sec 0.
  // Only the command that was already applied before keypad Start is stale.
  // A new seq from the phone is the same Start/Pause/Stop the keypad uses.
  if (gLocalHmiStartGuardMs != 0 &&
      (millis() - gLocalHmiStartGuardMs) < 8000UL &&
      (action == "stop" || action == "pause")) {
    const bool staleSeq =
        seq < 1 || seq == gSeqAtLocalStart || seq == gLastCommandSeq;
    if (staleSeq) {
      Serial.println("[command] ignore stale stop/pause after keypad start");
      return;
    }
  }
  if (gLocalHmiStartGuardMs != 0 &&
      (millis() - gLocalHmiStartGuardMs) < 5000UL &&
      (seq < 1 || seq == gLastCommandSeq)) {
    return;
  }
  // Same Firebase command node already handled. A leftover Start/Stop must not
  // undo a keypad Start or force the user to mash Stop after an app Start.
  if (seq > 0 && seq == gLastCommandSeq) {
    if (updatedAt == gLastCommandUpdated) return;
    if (action != gLastAppliedCommandAction) return;
  }

#if ENABLE_RTDB_HARDWARE_TEST
  // Hardware Status owns the outputs until the app sends stop (Done or X).
  if (hardwareTestActive()) {
    return;
  }
#endif

  const float tt =
      parseJsonFloatAfterKey(body, "target_temperature", gSessionTargetC);
  if (tt > 1.0f && tt < 120.0f) {
    gSessionTargetC = tt;
  }
  const int fs = parseJsonIntAfterKey(body, "fan_speed", gFanSpeedLevel);
  gFanSpeedLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);

  if (gAssignedId <= 0 && mid > 0) {
    gAssignedId = mid;
    persistAssignment(gAssignedId, gDeviceName);
  }

  if (seq > 0 && (action == "stop" || action == "pause" || action == "start")) {
    gBoardPublishedSeq = seq;
  }

  if (action == "stop") {
    if (seq > 0) {
      gLastCommandSeq = seq;
    }
    gLastAppliedCommandAction = action;
    gLastCommandUpdated = updatedAt;
    Serial.println("[command] stop");
    if (gKeypadOwnsHistory &&
        (gLocalHmiOwned || sessionStatusIsRunning() || sessionStatusIsPaused())) {
      queueLocalHistoryPayload(buildLocalSessionPayload("stop"));
    }
    gKeypadOwnsHistory = false;
    gDeferredRtdbStatus = "";
    gNeedStatePublish = false;
    forceIdleSessionState();
  #if ENABLE_LOCAL_HMI
    LocalHmi::adoptCloudStopped();
  #endif
    return;
  }

  if (action == "pause") {
    const int pauseRem = parseJsonIntAfterKey(body, "remaining_sec", -1);
    if (seq > 0) {
      gLastCommandSeq = seq;
    }
    gLastAppliedCommandAction = action;
    gLastCommandUpdated = updatedAt;
    Serial.println("[command] pause");
    if (gDeferredRtdbStatus == "running") {
      gDeferredRtdbStatus = "";
    }
    if (gDeferredApiAction == "start") {
      gDeferredApiAction = "";
    }
    gNeedStatePublish = false;
    enterPausedSession();
    if (pauseRem > 0) remainSet(pauseRem);
  #if ENABLE_LOCAL_HMI
    LocalHmi::adoptCloudPaused();
  #endif
    return;
  }

  if (action == "start") {
#if ENABLE_LOCAL_HMI
    if (LocalHmi::moisturePromptActive()) {
      Serial.println("[command] ignore start during moisture check");
      return;
    }
#endif
    if (gIgnoreCloudStartUntilMs != 0 &&
        (long)(millis() - gIgnoreCloudStartUntilMs) < 0) {
      if (seq > 0) gLastCommandSeq = seq;
      gLastAppliedCommandAction = "stop";
      Serial.println("[command] ignore start — keypad just stopped");
      return;
    }
    if (seq < 1 && !gDryRunAuthorized) {
      Serial.println("[command] ignore start without seq");
      initLoadPinsForcedOff();
      return;
    }
    const bool echoOfKeypad =
        gKeypadOwnsHistory && seq > 0 && seq == gLastCommandSeq;
    if (seq > 0) {
      gLastCommandSeq = seq;
    }
    gLastAppliedCommandAction = action;
    gLastCommandUpdated = updatedAt;
    gIgnoreStaleRunningUntilMs = 0;
    gLocalHmiOwned = true;
    if (!echoOfKeypad) gKeypadOwnsHistory = false;
    if (gLocalOfflineId.length() == 0) {
      gLocalOfflineId = newLocalOfflineId();
    }
    // Pull fish/qty/duration from command if present (app start).
    applySessionParamsFromBody(body);
    const int remSecCmd = parseJsonIntAfterKey(body, "remaining_sec", -1);
    if (sessionStatusIsPaused()) {
      if (remSecCmd >= 0) remainSet(remSecCmd);
      else {
        const int remMin = parseJsonIntAfterKey(body, "set_duration_minutes", 0);
        if (remMin > 0) remainSet((long)remMin * 60L);
      }
      gLocalRunSegmentStartMs = millis();
    } else if (!sessionStatusIsRunning()) {
      gLocalRunAccumMs = 0;
      gLocalRunSegmentStartMs = millis();
      if (remSecCmd >= 0) {
        remainSet(remSecCmd);
      } else {
        const int dm = parseJsonIntAfterKey(body, "set_duration_minutes", 0);
        if (dm > 0) remainSet((long)dm * 60L);
        else remainSet(gLocalDurationSec > 0 ? gLocalDurationSec : 60);
      }
      gLocalDurationSec = gRemainSec < 1 ? 1 : (int)gRemainSec;
      gLocalDurationMin = (gLocalDurationSec + 59) / 60;
    }
    if (sessionStatusIsRunning() && gDryRunAuthorized) {
      Serial.print("[command] start (params only) fan=");
      Serial.println(gFanSpeedLevel);
      applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
      persistActiveSession();
      gNeedStatePublish = true;
    #if ENABLE_LOCAL_HMI
      LocalHmi::adoptCloudSession(gLocalFishType, gLocalTotalFish, gSessionTargetC,
                                  (int)(gRemainSec > 0 ? gRemainSec : gLocalDurationSec));
    #endif
      return;
    }
    const bool chirp = !sessionStatusIsRunning();
    if (!sessionStatusIsRunning()) {
      gDryingSessionStartMs = millis();
    }
    Serial.print("[command] start mid=");
    Serial.println(mid);
    beginDryingOutputs(chirp);
    persistActiveSession();
    gNeedStatePublish = true;
  #if ENABLE_LOCAL_HMI
    LocalHmi::adoptCloudSession(gLocalFishType, gLocalTotalFish, gSessionTargetC,
                                (int)(gRemainSec > 0 ? gRemainSec : gLocalDurationSec));
  #endif
  }
}

static void applySessionLedsOnly() {
#if ENABLE_RTDB_HARDWARE_TEST
  if (hardwareTestActive()) return;
#endif
  applyLedsForSession(
      gSessionStatus.length() ? gSessionStatus : String("stopped"));
}

/**
 * Pull `machines/{gAssignedId}/session` from RTDB (status, fan_speed, target_temperature).
 * Mobile writes the whole object on Start/Pause/Stop.
 */
static void refreshSessionFromCloud(bool includeCommand = true) {
#if ENABLE_RTDB_HARDWARE_TEST
  if (hardwareTestActive()) return;
#endif
  if (gAssignedId <= 0) {
    (void)refreshAssignmentFromCloud();
  }
  const int mid = sessionMachineId();
  if (mid <= 0) {
    if (!gDryRunAuthorized) {
      initLoadPinsForcedOff();
    }
    return;
  }

  if (includeCommand) {
    applyCloudCommandFromRtdb(mid);
  }

  const String sessionPath =
      String("machines/") + String(mid) + "/session";
  const String body = rtdbGetText(sessionPath);
  if (body.length() == 0) {
    static unsigned long lastGetFailLogMs = 0;
    const unsigned long now = millis();
    if (lastGetFailLogMs == 0 || (now - lastGetFailLogMs) > 8000UL) {
      lastGetFailLogMs = now;
      Serial.print("[session] GET failed ");
      Serial.println(sessionPath);
    }
    // No internet / RTDB flake — keep drying or paused locally.
    if (gDryRunAuthorized && sessionStatusIsRunning()) {
      applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
    } else if (sessionStatusIsPaused() || gLocalHmiOwned) {
      // stay as-is
    } else if (gLastAppliedCommandAction == "start") {
      // Command start already applied; don't drop heaters on a failed GET.
    } else {
      initLoadPinsForcedOff();
    }
    return;
  }
  if (body == "null") {
    if (sessionStatusIsRunning() || sessionStatusIsPaused() || gLocalHmiOwned) {
      // Keep local/offline session alive if RTDB session node is empty.
      return;
    }
    Serial.println("[session] RTDB null — stopped");
    forceIdleSessionState();
    return;
  }
  gNullSessionPollStreak = 0;

  if (gAssignedId <= 0 && mid > 0) {
    gAssignedId = mid;
    persistAssignment(gAssignedId, gDeviceName);
  }

  String command = parseJsonStringAfterKey(body, "command", "");
  command.toLowerCase();
  command.trim();

  String status = parseSessionStatusFromBody(body);
  if (command == "pause") {
    status = "paused";
  } else if (command == "stop") {
    status = "stopped";
  } else if (command == "start") {
    status = "running";
  }

  applySessionParamsFromBody(body);

  {
    static String gLastCloudSessionStatus;
    if (status != gLastCloudSessionStatus) {
      gLastCloudSessionStatus = status;
      Serial.print("[session] cloud status=");
      Serial.print(status);
      if (command.length() > 0) {
        Serial.print(" cmd=");
        Serial.print(command);
      }
      Serial.println();
    }
  }

  if (command == "stop" || status == "stopped" || status == "idle" ||
      status == "complete" || status == "completed") {
    if (gHoldPowerResume && sessionStatusIsPaused() && command != "stop") {
      return;
    }
    // Previous batch left session.command=stop. A live start owns the machine
    // until that same command node says stop.
    if (gLastAppliedCommandAction == "start" &&
        (sessionStatusIsRunning() || sessionStatusIsPaused()) &&
        hmiRemainingDurationSec() > 2) {
      if (sessionStatusIsRunning() && gDryRunAuthorized) {
        applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
      }
      return;
    }
    if (command == "stop" || gLastAppliedCommandAction == "stop") {
      forceIdleSessionState();
    #if ENABLE_LOCAL_HMI
      LocalHmi::adoptCloudStopped();
    #endif
      return;
    }
    // Leftover session.stopped after a real Start — do not kill fan/heater,
    // and do not republish running over an app Stop (command path owns Stop).
    if (gDryRunAuthorized && gLastAppliedCommandAction == "start") {
      if (sessionStatusIsRunning()) {
        applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
      }
      return;
    }
    if (gLocalHmiOwned && (sessionStatusIsRunning() || sessionStatusIsPaused())) {
      if (sessionStatusIsRunning() && gDryRunAuthorized) {
        applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
      }
      return;
    }
    forceIdleSessionState();
    return;
  }

  if (command == "pause" || status == "paused") {
    if (gDryRunAuthorized && gLastAppliedCommandAction == "start" && command != "pause") {
      return;
    }
    gMoistureCheckArmed =
        parseJsonBoolAfterKey(body, "moisture_check_armed", true);
    const bool wasPaused = sessionStatusIsPaused();
    enterPausedSession();
  #if ENABLE_LOCAL_HMI
    if (!wasPaused) {
      LocalHmi::adoptCloudPaused();
    }
  #endif
    return;
  }

  if (status == "running" || command == "start") {
#if ENABLE_LOCAL_HMI
    if (LocalHmi::moisturePromptActive()) {
      return;
    }
#endif
    gMoistureCheckArmed = false;
    applySessionParamsFromBody(body);
    if (sessionStatusIsPaused() && command != "start") {
      return;
    }
    if (!gDryRunAuthorized) {
      // Leftover session.command=start must NOT turn fan/heater on.
      // Only a fresh command-node Start or keypad Enter authorizes loads.
      Serial.println("[session] no authorized Start — fan/heater OFF");
      initLoadPinsForcedOff();
      return;
    }
    if (!sessionStatusIsRunning()) {
      gSessionStatus = "running";
      gSessionActiveFlag = true;
      gDryingSessionStartMs = millis();
      if (gLocalRunSegmentStartMs == 0) {
        gLocalRunSegmentStartMs = millis();
      }
    }
  #if ENABLE_LOCAL_HMI
    LocalHmi::adoptCloudSession(gLocalFishType, gLocalTotalFish, gSessionTargetC,
                                (int)(gRemainSec > 0 ? gRemainSec : gLocalDurationSec));
  #endif
    if (gDryRunAuthorized && sessionStatusIsRunning()) {
      applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
    }
    return;
  }

  forceIdleSessionState();
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
  if (body[i] == '1') return true;
  if (body[i] == '0') return false;
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
  gTestActuateUntilMs = 0;
  gTestCombinedUiStarted = false;
  gTestFanLevel = 3;
  buzzerForceSilent();
  driveFanLoad(false);
  driveHeaterLoad(false);
  applyLedsForSession(gSessionStatus.length() ? gSessionStatus : String("stopped"));
#if ENABLE_LOCAL_HMI
  LocalHmi::endUiSelfTest();
#endif
  clearCloudTestCommand();
}

static void publishKeypadTestProgress(bool force) {
#if ENABLE_LOCAL_HMI
  // Do NOT HTTPS PUT here during keypad collection — it freezes getKey() for seconds.
  // Progress is published via heartbeat readings (keypad_keys_pressed).
  (void)force;
  LocalHmi::pollKeypadFast();
#else
  (void)force;
#endif
}

static void beginUiSelfTestForCommand(const String& mode, const String& component,
                                      int durationMs) {
#if ENABLE_LOCAL_HMI
  String c = component;
  c.toLowerCase();
  (void)durationMs;

  Serial.print("[test] UI self-test start mode=");
  Serial.print(mode);
  Serial.print(" component=");
  Serial.println(c);

  if (mode == "component" &&
      (c == "keypad" || c == "keypad_4x4" || c == "key_pad")) {
    LocalHmi::startKeypadSelfTest(0);
    return;
  }

  if (mode == "component" &&
      (c == "lcd" || c == "lcd_16x2" || c == "display")) {
    LocalHmi::startLcdSelfTest(0);
    return;
  }

  if (mode == "all") {
    gTestActuateUntilMs = 0;
    gTestCombinedUiStarted = true;
    LocalHmi::startCombinedUiSelfTest(0);
    return;
  }

  if (c == "fan" || c == "fan_1" || c == "fan_2" || c == "fan_3") {
    LocalHmi::showHardwareTestBanner("FAN TEST", "UNTIL DONE");
    return;
  }
  if (c == "heater" || c == "heater_1" || c == "heater_2") {
    LocalHmi::showHardwareTestBanner("HEATER TEST", "UNTIL DONE");
    return;
  }
  if (c == "led_1" || c == "led_drying") {
    LocalHmi::showHardwareTestBanner("GREEN LED", "UNTIL DONE");
    return;
  }
  if (c == "led_2" || c == "led_pause") {
    LocalHmi::showHardwareTestBanner("YELLOW LED", "UNTIL DONE");
    return;
  }
  if (c == "led_3" || c == "led_stop") {
    LocalHmi::showHardwareTestBanner("RED LED", "UNTIL DONE");
    return;
  }
  if (c == "buzzer" || c == "piezo" || c == "piezo_buzzer") {
    LocalHmi::showHardwareTestBanner("BUZZER TEST", "UNTIL DONE");
    return;
  }
#else
  (void)mode;
  (void)component;
  (void)durationMs;
#endif
}

/** Keep test outputs latched ON. Never pulse OFF then ON (that clicks the relays). */
static void holdHardwareTestActuators() {
  if (!hardwareTestActive()) return;

  if (gTestMode == "all") {
    driveLed(LED_GREEN, true);
    driveLed(LED_YELLOW, true);
    driveLed(LED_RED, true);
    driveFanLoad(true);
    driveHeaterLoad(true);
    buzzerTestDrive();
    return;
  }

  String c = gTestComponent;
  c.toLowerCase();
  if (c == "fan" || c == "fan_1" || c == "fan_2" || c == "fan_3") {
    driveHeaterLoad(false);
    driveFanLoad(true);
    applyLedsForSession("running");
    return;
  }
  if (c == "heater" || c == "heater_1" || c == "heater_2") {
    driveFanLoad(false);
    driveHeaterLoad(true);
    applyLedsForSession("running");
    return;
  }
  if (c == "buzzer" || c == "piezo" || c == "piezo_buzzer") {
    driveFanLoad(false);
    driveHeaterLoad(false);
    buzzerTestDrive();
    applyLedsForSession("running");
    return;
  }
  if (c == "led_1" || c == "led_drying") {
    driveFanLoad(false);
    driveHeaterLoad(false);
    driveLed(LED_GREEN, true);
    driveLed(LED_YELLOW, false);
    driveLed(LED_RED, false);
    return;
  }
  if (c == "led_2" || c == "led_pause") {
    driveFanLoad(false);
    driveHeaterLoad(false);
    driveLed(LED_GREEN, false);
    driveLed(LED_YELLOW, true);
    driveLed(LED_RED, false);
    return;
  }
  if (c == "led_3" || c == "led_stop") {
    driveFanLoad(false);
    driveHeaterLoad(false);
    driveLed(LED_GREEN, false);
    driveLed(LED_YELLOW, false);
    driveLed(LED_RED, true);
    return;
  }
  driveFanLoad(false);
  driveHeaterLoad(false);
  buzzerForceSilent();
  applyLedsForSession(gSessionStatus);
}

static void tickHardwareTestOutputs() {
  // Stay latched until Done or X clears test_command. Do not time out.
#if ENABLE_LOCAL_HMI
  if (LocalHmi::keypadSelfTestWaiting() || LocalHmi::uiSelfTestActive()) {
    LocalHmi::pollKeypadFast();
  }
#endif
  holdHardwareTestActuators();
}

static void refreshTestCommandFromCloud() {
  if (gAssignedId <= 0) {
    static unsigned long lastNoIdLogMs = 0;
    const unsigned long now = millis();
    if (lastNoIdLogMs == 0 || (now - lastNoIdLogMs) > 30000UL) {
      lastNoIdLogMs = now;
      Serial.println("[test] skip — Assigned ID is 0; save board in app (assignments/MAC)");
    }
    return;
  }
  // A drying run blocks a new test. An already-running test stays up until Done or X.
  if (!hardwareTestActive() && sessionBlocksHardwareTest()) {
    return;
  }
  const String body = rtdbGetText(
      String("machines/") + String(gAssignedId) + "/test_command", 600);
  if (body.length() == 0) {
    // GET failed — do not treat as Done. Keep heater/fan running.
    return;
  }
  String trimmed = body;
  trimmed.trim();
  if (trimmed == "null") {
    if (hardwareTestActive()) endHardwareTest();
    return;
  }

  const String mode = parseJsonStringAfterKey(body, "mode", "");
  const String component = parseJsonStringAfterKey(body, "component", "");
  const String reqId = parseJsonStringAfterKey(body, "request_id", "");
  (void)parseJsonIntAfterKey(body, "duration_ms", 0);

  if (mode == "stop" || mode == "done" || mode == "off") {
    endHardwareTest();
    return;
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

  if (reqId == gLastTestRequestId && hardwareTestActive()) {
    return;
  }

  gLastTestRequestId = reqId;
  gTestMode = mode;
  gTestComponent = component;
  gTestModeUntilMs = 0;
  int fs = parseJsonIntAfterKey(body, "fan_speed", 3);
  gTestFanLevel = fs < 1 ? 1 : (fs > 3 ? 3 : fs);
  Serial.print("[test] ");
  Serial.print(mode);
  Serial.print(" component=");
  Serial.print(component);
  Serial.println(" until Done");
  beginUiSelfTestForCommand(mode, component, 0);
  holdHardwareTestActuators();
  if (gAssignedId > 0 && reqId.length() > 0) {
    String ack = "{\"request_id\":\"";
    ack += reqId;
    ack += "\",\"status\":\"running\",\"component\":\"";
    ack += component;
    ack += "\"}";
    (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_ack", ack);
  }
}

static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody,
                        unsigned long timeoutMs) {
  serviceLocalHmiKeys();
  if (WiFi.status() != WL_CONNECTED) return false;
  const int code = rtdbHttp("PUT", pathNoJsonSuffix, &jsonBody, nullptr, timeoutMs);
  serviceLocalHmiKeys();
  if (code < 200 || code >= 300) {
    rtdbLogFail("PUT", code, pathNoJsonSuffix);
    return false;
  }
  return true;
}

/** Same timeouts as a full PUT. A 600 ms handshake abort was dropping the board Offline. */
static bool rtdbPutJsonQuick(const String& pathNoJsonSuffix, const String& jsonBody) {
  return rtdbPutJson(pathNoJsonSuffix, jsonBody);
}

static String jsonEscape(const String& in) {
  String out;
  out.reserve(in.length() + 2);
  for (unsigned i = 0; i < in.length(); i++) {
    const char c = in[i];
    if (c == '"' || c == '\\') out += '\\';
    if (c == '\n' || c == '\r') continue;
    out += c;
  }
  return out;
}

/**
 * Add Machine reads discovery/{MAC} for every powered board, saved or not.
 * This must not wait on machines/{id} — a new board has no id yet.
 * device_id stays the MAC-based id so a renamed board is not saved again
 * and a different board is not treated as that rename.
 */
static bool publishDiscoveryAdvertisement() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (gDeviceMacSafe.length() < 12) return false;
  if (gHardwareDeviceId.length() == 0) gHardwareDeviceId = gDeviceName;

  String adv;
  adv.reserve(420);
  adv += "{";
  adv += "\"microcontroller_id\":"; adv += gAssignedId;
  adv += ",\"name\":\""; adv += jsonEscape(gDeviceName); adv += "\"";
  adv += ",\"device_id\":\""; adv += jsonEscape(gHardwareDeviceId); adv += "\"";
  adv += ",\"mac\":\""; adv += gDeviceMac; adv += "\"";
  adv += ",\"ip\":\""; adv += WiFi.localIP().toString(); adv += "\"";
  adv += ",\"rssi\":"; adv += WiFi.RSSI();
  adv += ",\"assigned\":"; adv += (gAssignedId > 0) ? "true" : "false";
  gDiscoverySeq++;
  if (gDiscoverySeq == 0) gDiscoverySeq = 1;
  adv += ",\"seq\":"; adv += gDiscoverySeq;
  {
    const time_t nowSec = time(nullptr);
    if (nowSec > 1700000000) {
      char msBuf[24];
      snprintf(msBuf, sizeof(msBuf), "%llu", (unsigned long long)nowSec * 1000ULL);
      adv += ",\"epoch_ms\":";
      adv += msBuf;
    }
  }
  adv += ",\"updated_at\":{\".sv\":\"timestamp\"}";
  adv += "}";

  // First TLS handshake is often slower than 3s. A short budget drops the
  // advertisement and Add Machine never sees the new MAC.
  const bool ok = rtdbPutJson(String("discovery/") + gDeviceMacSafe, adv, 8000UL);
  if (ok) {
    gLastDiscoveryOkMs = millis();
    static unsigned long lastDiscLogMs = 0;
    if (lastDiscLogMs == 0 || (millis() - lastDiscLogMs) > 15000UL) {
      lastDiscLogMs = millis();
      Serial.print("[RTDB] discovery OK discovery/");
      Serial.print(gDeviceMacSafe);
      Serial.print(gAssignedId > 0 ? " assigned id=" : " NEW (id 0)");
      if (gAssignedId > 0) Serial.print(gAssignedId);
      Serial.println();
    }
  }
  return ok;
}

/** Merge keys only. A PUT here would wipe readings and component status. */
static bool rtdbPatchJson(const String& pathNoJsonSuffix, const String& jsonBody) {
  serviceLocalHmiKeys();
  if (WiFi.status() != WL_CONNECTED) return false;
  const int code = rtdbHttp("PATCH", pathNoJsonSuffix, &jsonBody, nullptr, 2000UL);
  serviceLocalHmiKeys();
  if (code < 200 || code >= 300) {
    rtdbLogFail("PATCH", code, pathNoJsonSuffix);
    return false;
  }
  return true;
}

/**
 * Online pulse. One shallow update so Start/Pause/Stop and hardware tests
 * are not stuck behind a full sensor upload. Never skipped for the keypad screen.
 */
static bool sendPresencePulse() {
  const int publishId = ownedPublishId(false);
  // No id yet: machines/{id} does not exist. The 2s presence slot is the only
  // request this board gets, so it must refresh discovery/{MAC} or Add Machine
  // never sees a new microcontroller (heartbeat is starved while presence is late).
  if (publishId <= 0) {
    gLastDiscoveryAttemptMs = millis();
    const bool adv = publishDiscoveryAdvertisement();
    if (adv) gLastPresenceOkMs = millis();
    return adv;
  }
  // Assigned boards must keep discovery/{MAC} fresh or Add Machine only sees
  // the old saved row. Refresh the beacon at least every 4s, then still patch
  // hardware_status on this same turn when the beacon was already fresh.
  // Returning here on success was skipping the heartbeat, so the Online card
  // could disagree with the beacon.
  {
    const unsigned long nowMs = millis();
    const bool discoveryDue =
        gLastDiscoveryOkMs == 0 || (nowMs - gLastDiscoveryOkMs) >= 4000UL;
    const bool attemptGap =
        gLastDiscoveryAttemptMs == 0 || (nowMs - gLastDiscoveryAttemptMs) >= 4000UL;
    if (discoveryDue && attemptGap) {
      gLastDiscoveryAttemptMs = nowMs;
      (void)publishDiscoveryAdvertisement();
    }
  }
  String st = gSessionStatus.length() ? gSessionStatus : String("stopped");
  st.toLowerCase();
  st.trim();
  if (st != "running" && st != "paused") st = "stopped";

  String body;
  body.reserve(280);
  // Online pulse only. Sensor rows come from the full heartbeat — this used
  // to force esp32/moisture "working" and the app showed a false status.
  body += "{\"updated_at\":{\".sv\":\"timestamp\"}";
  body += ",\"microcontroller_id\":";
  body += publishId;
  body += ",\"session_status\":\"";
  body += st;
  body += "\"";
  {
    long rem = 0;
    if (sessionStatusIsRunning() || sessionStatusIsPaused()) {
      rem = hmiRemainingDurationSec();
      if (rem < 0) rem = 0;
    }
    body += ",\"remaining_sec\":";
    body += rem;
  }
  body += "}";

  const bool ok = rtdbPatchJson(
      String("machines/") + String(publishId) + "/hardware_status", body);
  if (ok) gLastPresenceOkMs = millis();
  return ok;
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
    http.setTimeout(4000);
    http.setConnectTimeout(3000);
    const String statusUrl = laravelStatusUrl();
    if (statusUrl.length() == 0) {
      Serial.println("Heartbeat skipped — waiting for Firebase lan/server");
      return false;
    }
    if (!http.begin(client, statusUrl)) {
      Serial.println("Heartbeat: http.begin failed — Laravel URL from lan/server");
      delay(500);
      continue;
    }
    http.addHeader("Content-Type", "application/json");

    Serial.print("Posting heartbeat to ");
    Serial.print(statusUrl);
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
        Serial.println("Laravel unreachable — waiting for lan/server + artisan serve. RTDB/mobile still OK.");
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

    if (!gDryingOutputsLatched && !hardwareTestActive() && !sessionAllowsActuators()) {
      loadsHardwareAllOff();
    }
    delay(200);
  }
  gLaravelPostBackoffUntilMs = millis() + 45000UL;
  return false;
}

static bool shouldForceLoadsOff() {
  return !sessionStatusIsRunning() && !hardwareTestActive();
}

bool sendHeartbeat(bool /*dhtOk*/, bool /*moistureOk*/, bool /*doorOk*/) {
  const int publishId = ownedPublishId(true);
#if ENABLE_LOCAL_HMI
  (void)LocalHmi::confirmLcdPresent();
#endif
  const bool esp32Ok = esp32SelfCheckOk();
  // `components.esp32` in JSON/RTDB = "MCU online" (Wi‑Fi path works). Heap/reset
  // self-check still drives Serial + alert buzzer via `esp32Ok`.
  const bool esp32UiOnline = (WiFi.status() == WL_CONNECTED);
  const bool dhtOkReport = pollDhtIfDue();
  const float t = cachedDhtT;
  const float h = cachedDhtH;

  const int moistureRaw = gMoistureAvgCached;
  const int spread = gMoistureSpreadCached;
  const bool moistureOkReport = gMoistureHaveSample && gLiveMoisturePct >= 0;
  const int moisturePct = moistureOkReport ? gLiveMoisturePct : -1;

  int doorHighs = 0;
  int doorLows = 0;
  int doorTransitions = 0;
#if HAVE_DOOR_SENSOR
  readDoorSensorSample(doorHighs, doorLows, doorTransitions);
#endif
  const bool doorOkReport =
      doorSensorOkFromSample(doorHighs, doorLows, doorTransitions);
  const bool doorOkAlert = doorOkReport;
  const bool doorOpen = doorIsOpenFromSample(doorHighs, doorLows);

  {
    static unsigned long lastHbLogMs = 0;
    if (lastHbLogMs == 0 || (millis() - lastHbLogMs) > 15000UL) {
      lastHbLogMs = millis();
      Serial.print("MOISTURE raw=");
      Serial.print(moistureRaw);
      Serial.print(" pct=");
      Serial.print(moistureOkReport ? moisturePct : -1);
      Serial.print(" DHT=");
      Serial.print(dhtOkReport ? "OK" : "FAIL");
      Serial.print(" sess=");
      Serial.print(gSessionStatus);
      Serial.print(" heap=");
      Serial.println((unsigned int)ESP.getFreeHeap());
    }
  }

  {
    static bool sDiagLogged = false;
    if (!sDiagLogged &&
        (!dhtOkReport || !moistureOkReport ||
         (HAVE_DOOR_SENSOR && !doorOkReport) || !esp32Ok)) {
      sDiagLogged = true;
      Serial.print("[diag] reset_reason=");
      Serial.print((int)esp_reset_reason());
      Serial.print(" | HAVE_DOOR_SENSOR=");
      Serial.println(HAVE_DOOR_SENSOR ? 1 : 0);
    }
  }

  if (gHardwareDeviceId.length() == 0) gHardwareDeviceId = gDeviceName;

  String payload;
  payload.reserve(900);

  payload += "{";
  payload += "\"microcontroller_id\":";
  payload += gAssignedId;
  // Always include MAC + name so Laravel can resolve unassigned boards by hardware identity.
  payload += ",\"device_id\":\""; payload += gHardwareDeviceId; payload += "\"";
  payload += ",\"mac\":\""; payload += gDeviceMac; payload += "\"";

  // Only sensors with real signals are reported. Outputs (LEDs, heaters, fans, buzzer)
  // have no feedback line, so the app intentionally does not list them.
  payload += ",\"components\":{";

  payload += "\"esp32\":\""; payload += statusWord(esp32UiOnline); payload += "\",";
  payload += "\"dht22\":\""; payload += statusWord(dhtOkReport); payload += "\",";
  payload += "\"moisture_sensor\":\""; payload += moistureStatusWord(moistureOkReport); payload += "\",";
  payload += "\"door_sensor\":\""; payload += statusWord(doorOkReport); payload += "\",";
  payload += "\"lcd\":\""; payload += statusWord(LocalHmi::lcdWorking()); payload += "\",";
  payload += "\"keypad\":\""; payload += LocalHmi::keypadWorking() ? "working" : "unknown"; payload += "\"";

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
    laravelReadingsComma();
    payload += "\"moisture_connected\":";
    payload += moistureOkReport ? "true" : "false";
    laravelReadingsComma();
    payload += "\"moisture_spread\":";
    payload += spread;
    laravelReadingsComma();
    payload += "\"moisture_raw\":";
    payload += moistureRaw;
    if (moistureOkReport && moisturePct >= 0) {
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

  // Push snapshot to Firebase RTDB first — mobile + Laravel read this path.
  String root;
  root.reserve(800);
  root += "{";
  root += "\"microcontroller_id\":"; root += publishId;
  // Per-board identity: name + MAC so the app can tell physical boards apart even if you reuse IDs.
  root += ",\"name\":\""; root += gDeviceName; root += "\"";
  root += ",\"device_id\":\""; root += gHardwareDeviceId; root += "\"";
  root += ",\"mac\":\""; root += gDeviceMac; root += "\"";
  // Mobile Online uses Firebase server time so phone/ESP clock skew cannot fake Offline.
  root += ",\"updated_at\":{\".sv\":\"timestamp\"}";
  root += ",\"session_status\":\"";
  {
    String st = gSessionStatus.length() ? gSessionStatus : String("stopped");
    st.toLowerCase();
    st.trim();
    if (st != "running" && st != "paused") st = "stopped";
    root += st;
  }
  root += "\"";
  root += ",\"remaining_sec\":";
  {
    long rem = 0;
    if (sessionStatusIsRunning() || sessionStatusIsPaused()) {
      rem = hmiRemainingDurationSec();
      if (rem < 0) rem = 0;
    }
    root += rem;
  }
  {
    String fish = gLocalFishType;
    fish.replace("\\", "\\\\");
    fish.replace("\"", "\\\"");
    root += ",\"fish_type\":\"";
    root += fish;
    root += "\",\"total_fish\":";
    root += gLocalTotalFish;
    root += ",\"target_temperature\":";
    root += String(gSessionTargetC > 1.0f ? gSessionTargetC : 0.0f, 1);
    if (gLocalDurationMin > 0 &&
        (sessionStatusIsRunning() || sessionStatusIsPaused() || gLocalOfflineId.length())) {
      root += ",\"set_duration_minutes\":";
      root += gLocalDurationMin;
    }
    if (gLocalOfflineId.length()) {
      root += ",\"offline_id\":\"";
      root += gLocalOfflineId;
      root += "\",\"source\":\"";
      root += gKeypadOwnsHistory ? "local_hmi" : "app";
      root += "\"";
    }
    if (gStopReason[0]) {
      root += ",\"stop_reason\":\"";
      root += gStopReason;
      root += "\"";
    }
  }

  root += ",\"components\":{";
  root += "\"esp32\":\""; root += statusWord(esp32UiOnline); root += "\",";
  root += "\"door_sensor\":\""; root += statusWord(doorOkReport); root += "\",";
  root += "\"moisture_sensor\":\""; root += moistureStatusWord(moistureOkReport); root += "\",";
  root += "\"dht22\":\""; root += statusWord(dhtOkReport); root += "\",";
  root += "\"lcd\":\""; root += statusWord(LocalHmi::lcdWorking()); root += "\",";
  root += "\"keypad\":\""; root += LocalHmi::keypadWorking() ? "working" : "unknown"; root += "\"";
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
    readingsComma();
    root += "\"moisture_connected\":";
    root += moistureOkReport ? "true" : "false";
    readingsComma();
    root += "\"moisture_spread\":";
    root += spread;
    readingsComma();
    root += "\"moisture_raw\":";
    root += moistureRaw;
    if (moistureOkReport && moisturePct >= 0) {
      readingsComma();
      root += "\"moisture\":";
      root += moisturePct;
      root += ",\"moisture_percent\":";
      root += moisturePct;
    }
    if (doorOkReport) {
      readingsComma();
      root += "\"door\":\"";
      root += (doorOpen ? "open" : "closed");
      root += "\"";
    }
  #if ENABLE_LOCAL_HMI
    if (LocalHmi::uiSelfTestActive()) {
      readingsComma();
      root += "\"keypad_keys_pressed\":";
      root += String((unsigned)LocalHmi::keypadSelfTestCount());
      readingsComma();
      root += "\"keypad_keys_total\":16";
      readingsComma();
      root += "\"ui_self_test\":true";
    }
  #endif
    readingsComma();
    root += "\"outputs\":{";
  }
  appendOutputsTelemetry(root, dhtOkReport, t);
  root += "}";
  root += "}";
  root += "}";

  // Only publish to machines/{id}/... once this MAC owns that id.
  // Otherwise the board just advertises in discovery/ and does not
  // overwrite another machine's component status.
  bool presenceOk = false;
  if (publishId > 0) {
    const bool rtdbOk =
        rtdbPutJson(String("machines/") + String(publishId) + "/hardware_status", root);
    presenceOk = rtdbOk;
    if (rtdbOk) {
      gLastPresenceOkMs = millis();
      if (!gLastBeatOk || gNeedStatePublish) {
        const char* st = sessionStatusIsRunning() ? "running"
            : (sessionStatusIsPaused() ? "paused" : "stopped");
        (void)publishLocalSessionToRtdb(st);
        gNeedStatePublish = false;
      }
    }
    static unsigned long lastRtdbOkLogMs = 0;
    if (!rtdbOk) {
      Serial.println("[RTDB] hardware_status PUT failed — check WiFi / Firebase rules");
    } else if (lastRtdbOkLogMs == 0 || (millis() - lastRtdbOkLogMs) > 30000UL) {
      lastRtdbOkLogMs = millis();
      Serial.print("[RTDB] telemetry OK machines/");
      Serial.print(publishId);
      Serial.println("/hardware_status");
    }
  } else {
    static unsigned long lastNoIdLogMs = 0;
    if (lastNoIdLogMs == 0 || (millis() - lastNoIdLogMs) > 15000UL) {
      lastNoIdLogMs = millis();
      Serial.println("[RTDB] skip machines/{id}/ — Assigned ID is 0; save board in app");
    }
  }

  commitLoadRelays(dhtOkReport, t);

  #if SEND_TO_LARAVEL
    if (!gDryingOutputsLatched) {
      postJsonWithRetries(payload, 2);
    }
  #endif

  // Saved and unsaved boards both stay visible to Add Machine.
  const bool advOk = publishDiscoveryAdvertisement();
  if (publishId <= 0) {
    // Boot and the 8s heartbeat must count as success, or gLastBeatOk stays
    // false and the board never polls assignments/{MAC} after the user saves it.
    return advOk;
  }
  return presenceOk;
}

static void applySafeOutputDefaults() {
#if START_WITH_OUTPUTS_ENERGIZED
  driveFanLoad(true);
  driveHeaterLoad(true);
#else
  loadsHardwareAllOff();
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
  driveFanLoad(on);
  driveHeaterLoad(on);
  if (!on) buzzerForceSilent();
}

#if LED_BOOT_SWEEP
/** One-time boot proof: each colour lights in order, then idle RED. */
static void runBootLedSweep() {
  Serial.println("[led] boot sweep (GPIO18=G, 5=Y, 15=R)");
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

  driveFanLoad(true);
  driveHeaterLoad(true);

  buzzerHwStart();
  delay(120);
  buzzerForceSilent();
}
#endif

static unsigned long gLastAssignmentPollMs = 0;

static void readSensorsOnce(bool& dhtOk, bool& moistureOk, bool& doorOk, bool& doorOpen) {
  // Typing must not wait on a 24-sample ADC sweep or a 32-read door scan.
  if (LocalHmi::isTypingParams()) {
    dhtOk = lastDhtReadOk;
    moistureOk = gMoistureHaveSample;
    doorOk = false;
    doorOpen = false;
    return;
  }
  dhtOk = pollDhtIfDue();

  if (millis() - gLastMoistureSampleMs >= 250UL) {
    gLastMoistureSampleMs = millis();
    int minV = 0;
    int maxV = 0;
    readMoistureAdc(gMoistureAvgCached, gMoistureSpreadCached, minV, maxV);
    gMoistureMinCached = minV;
    gMoistureMaxCached = maxV;
  }
  moistureOk = gMoistureHaveSample && gLiveMoisturePct >= 0;

#if HAVE_DOOR_SENSOR
  int doorHighs = 0;
  int doorLows = 0;
  int doorTransitions = 0;
  readDoorSensorSample(doorHighs, doorLows, doorTransitions);
  doorOk = doorSensorOkFromSample(doorHighs, doorLows, doorTransitions);
  doorOpen = doorOk && doorIsOpenFromSample(doorHighs, doorLows);
#else
  doorOk = false;
  doorOpen = false;
#endif
}

/** GPIO/actuator init — after WiFi so relay/fan cannot crash the radio stack. */
static void initHardwarePins() {
  pinMode(LED1, OUTPUT);
  pinMode(LED2, OUTPUT);
  pinMode(LED3, OUTPUT);

  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_HEATER1, OUTPUT);
  pinMode(RELAY_HEATER2, OUTPUT);
  loadsHardwareAllOff();

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerForceSilent();
#if BUZZER_BOOT_TEST_SEC > 0
  buzzerAlarmBlockingSeconds(BUZZER_BOOT_TEST_SEC);
#endif

  doorPinAsInput();
  analogReadResolution(12);
#ifdef ARDUINO_ARCH_ESP32
  analogSetAttenuation(ADC_11db);
  analogSetPinAttenuation(PIN_MOISTURE, ADC_11db);
#endif

  applySafeOutputDefaults();

#if WIRING_CHECK_AT_BOOT
  runBootWiringCheck();
#elif ENABLE_POWER_ON_SELFTEST
  applyBenchSelfTestOutputs();
#elif LED_BOOT_SWEEP
  runBootLedSweep();
#endif

#if RELAY_BOOT_CLICK_MS > 0
  relayBootClickTest();
#endif
#if HEATER_BOOT_CLICK_MS > 0
  heaterBootClickTest();
#endif

  dht.begin();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  loadBootSnap();

  gBootMs = millis();
  gIgnoreStaleRunningUntilMs = gBootMs + 12000UL;
  initLoadPinsForcedOff();

#if defined(ESP32)
  esp_task_wdt_deinit();
#endif

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
#if defined(ESP32)
  esp_wifi_set_ps(WIFI_PS_NONE);
#endif
  WiFi.setAutoReconnect(true);

  Serial.println();
  Serial.println("##############################################");
  Serial.println("# Fish Dryer ESP32 — runtime-assigned identity");
  Serial.print("# BUILD: ");
  Serial.println(FIRMWARE_BUILD_TAG);
  Serial.println("# PINS: DHT22=4 MOISTURE=35 DOOR=34 FAN=22 H1=19 BUZZER=17");
  Serial.println("#       LED green=18 yellow=5 red=15  LCD SDA=21 SCL=23");
#if ENABLE_LOCAL_HMI
  Serial.println("# HMI FIRST — local LCD/keypad before WiFi");
  Serial.println("# HMI KEYPAD L->R 13,12,14,27 ROWS  then 26,25,33,32 COLS");
#endif
#if HEATER_CONTROL_IS_SSR && !HEATER_SSR_SINK_5V
  Serial.println("# HEATER SSR: GPIO19->SSR3(+), GND->SSR4(-), HIGH=running, LOW=stopped");
#endif
  Serial.println("##############################################");
  Serial.printf("Reset reason: %d\n", (int)esp_reset_reason());

  // HMI before WiFi — no network blocking while user learns keypad.
  Serial.println("[boot] hardware init...");
  gDryRunAuthorized = false;
  forceIdleSessionState();
  initHardwarePins();
  applyLedsForSession("stopped");
#if ENABLE_LOCAL_HMI
  LocalHmi::begin();
  // 1s keypad-only before WiFi — then loop keeps network quiet during local use
  for (int i = 0; i < 100; i++) {
    LocalHmi::poll();
    delay(10);
  }
#endif

  connectWifiBlocking();
  syncClockOnce();

  initIdentity();
  (void)refreshAssignmentFromCloud();
  clearCloudTestCommand();
  gLastTestRequestId = "";
  gTestMode = "";
  gTestComponent = "";
  gTestModeUntilMs = 0;
  gFaultBuzzerArmed = false;
  disengageBuzzerAlarm();

  Serial.println("---- IDENTITY ----");
  Serial.print("MAC          : "); Serial.println(gDeviceMac);
  Serial.print("Name         : "); Serial.println(gDeviceName);
  Serial.print("Assigned ID  : "); Serial.println(gAssignedId);
  if (gAssignedId > 0) {
    Serial.print("RTDB path    : machines/"); Serial.print(gAssignedId); Serial.println("/hardware_status");
  } else {
    Serial.println("RTDB path    : (none — id is 0)");
    Serial.println("              Save the board in the app (Detect → Save).");
  }
  Serial.print("Discovery    : discovery/"); Serial.println(gDeviceMacSafe);
  Serial.println("------------------");

  if (gAssignedId > 0) {
    consumeCloudCommandSeq(gAssignedId);
  }
  applyBootSnap();
  gSessionPersistEnabled = true;
  Serial.println("[boot] hardware OK");

  delay(200);

  migratePendIntoQueue();
  gPrefs.begin("fdhmi", true);
  {
    const String savedApi = gPrefs.getString("api", "");
    if (savedApi.length() > 0 && gLaravelApiBase.length() == 0) {
      gLaravelApiBase = savedApi;
    }
  }
  gPrefs.end();
  Serial.println("=== HEARTBEAT START ===");
  Serial.print("Polarity: RELAY_ACTIVE_LOW=");
  Serial.print(RELAY_ACTIVE_LOW ? 1 : 0);
  Serial.print(" LED_ON_IS_HIGH=");
  Serial.print(LED_ON_IS_HIGH ? 1 : 0);
  Serial.print(" START_WITH_OUTPUTS_ENERGIZED=");
  Serial.print(START_WITH_OUTPUTS_ENERGIZED ? 1 : 0);
  Serial.print(" WIRING_CHECK_AT_BOOT=");
  Serial.println(WIRING_CHECK_AT_BOOT ? 1 : 0);
  Serial.print("[relay] NO-only COM→+ fan red→NO black→− ACTIVE_LOW=");
  Serial.print(RELAY_ACTIVE_LOW ? 1 : 0);
  Serial.print(" SSRheat=");
  Serial.print(HEATER_CONTROL_IS_SSR ? 1 : 0);
  Serial.print(" idle fan=");
  Serial.print(fanLoadIsOn() ? 1 : 0);
  Serial.print(" h1=");
  Serial.print(heaterLoadIsOn(RELAY_HEATER1) ? 1 : 0);
  Serial.print(" h2=");
  Serial.println(heaterLoadIsOn(RELAY_HEATER2) ? 1 : 0);

  bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
  readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);
  initLoadPinsForcedOff();
  gLastBeatOk = sendHeartbeat(dhtOk, moistureOk, doorOk);
  lastHeartbeatMs = millis();
}

// ---------------------------------------------------------------------------
// Local HMI (LCD + keypad) — independent start/pause/stop + history via Laravel
// ---------------------------------------------------------------------------
static unsigned long localHmiElapsedSeconds() {
  unsigned long ms = gLocalRunAccumMs;
  if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
    ms += (millis() - gLocalRunSegmentStartMs);
  }
  return ms / 1000UL;
}

static void remainCatchUp() {
  if (gRemainTickMs == 0 || !sessionStatusIsRunning()) return;
  const unsigned long now = millis();
  const unsigned long dt = now - gRemainTickMs;
  const unsigned long dec = dt / 1000UL;
  if (dec == 0) return;
  gRemainTickMs += dec * 1000UL;
  gRemainSec -= (long)dec;
  if (gRemainSec < 0) gRemainSec = 0;
}

static void remainArm() {
  gRemainTickMs = millis();
}

static void remainFreeze() {
  remainCatchUp();
  gRemainTickMs = 0;
}

static void remainSet(long sec) {
  gRemainSec = sec < 0 ? 0 : sec;
}

static void clearPersistedSession() {
  gPrefs.begin("fdsess", false);
  gPrefs.putUChar("on", 0);
  gPrefs.end();
}

static void persistActiveSession() {
  if (!sessionStatusIsRunning() && !sessionStatusIsPaused()) {
    clearPersistedSession();
    return;
  }
  gPrefs.begin("fdsess", false);
  gPrefs.putUChar("on", 1);
  gPrefs.putUChar("st", sessionStatusIsPaused() ? 2 : 1);
  gPrefs.putString("fish", gLocalFishType);
  gPrefs.putInt("qty", gLocalTotalFish);
  gPrefs.putInt("tc", (int)(gSessionTargetC * 10.0f));
  gPrefs.putInt("dur", gLocalDurationSec);
  gPrefs.putInt("rem", (int)gRemainSec);
  gPrefs.putUInt("el", (uint32_t)localHmiElapsedSeconds());
  gPrefs.putUChar("fan", (uint8_t)(gFanSpeedLevel < 1 ? 1 : gFanSpeedLevel));
  gPrefs.putUChar("own", gLocalHmiOwned ? 1 : 0);
  gPrefs.putUChar("kpad", gKeypadOwnsHistory ? 1 : 0);
  gPrefs.putString("oid", gLocalOfflineId);
  gPrefs.end();
}

static void loadBootSnap() {
  gPrefs.begin("fdsess", true);
  gBootSnapValid = gPrefs.getUChar("on", 0) == 1;
  if (gBootSnapValid) {
    gBootFish = gPrefs.getString("fish", "");
    gBootQty = gPrefs.getInt("qty", 0);
    gBootTemp = gPrefs.getInt("tc", 600) / 10.0f;
    gBootDur = gPrefs.getInt("dur", 0);
    gBootElapsed = gPrefs.getUInt("el", 0);
    gRemainSec = gPrefs.getInt("rem", 0);
    gBootFan = gPrefs.getUChar("fan", 1);
    gBootOwned = gPrefs.getUChar("own", 0) == 1;
    gKeypadOwnsHistory = gPrefs.getUChar("kpad", 0) == 1;
    gBootOid = gPrefs.getString("oid", "");
  }
  gPrefs.end();
}

static void applyBootSnap() {
  if (!gBootSnapValid) return;
  if (gBootDur < 1 && gBootFish.length() == 0) {
    gBootSnapValid = false;
    clearPersistedSession();
    return;
  }
  gLocalFishType = gBootFish;
  gLocalTotalFish = gBootQty;
  gSessionTargetC = (gBootTemp > 1.0f && gBootTemp < 120.0f) ? gBootTemp : 60.0f;
  gLocalDurationSec = gBootDur < 1 ? 1 : gBootDur;
  gLocalDurationMin = (gLocalDurationSec + 59) / 60;
  gFanSpeedLevel = gBootFan < 1 ? 1 : (gBootFan > 3 ? 3 : gBootFan);
  gLocalHmiOwned = gBootOwned;
  gLocalOfflineId = gBootOwned ? gBootOid : String("");
  if ((unsigned long)gLocalDurationSec > 0 && gBootElapsed > (unsigned long)gLocalDurationSec) {
    gBootElapsed = (unsigned long)gLocalDurationSec;
  }
  gLocalRunAccumMs = gBootElapsed * 1000UL;
  gLocalRunSegmentStartMs = 0;
  if (gRemainSec < 1) {
    long left = (long)gLocalDurationSec - (long)gBootElapsed;
    remainSet(left > 0 ? left : 0);
  }
  gRemainTickMs = 0;
  gDryRunAuthorized = false;
  gDryingOutputsLatched = false;
  gSessionActiveFlag = false;
  gSessionStatus = "paused";
  gFaultBuzzerArmed = false;
  clearHeaterTempMemory();
  resetDoorOpenBuzzerPolicy();
  disengageBuzzerAlarm();
  forceActuatorsOff();
  applyLedsForSession("paused");
  gSessionPersistEnabled = true;
  persistActiveSession();
  const long rem = (long)gLocalDurationSec - (long)gBootElapsed;
#if ENABLE_LOCAL_HMI
  LocalHmi::showInterruptedSession(gLocalFishType, gLocalTotalFish, gSessionTargetC, rem);
#endif
  queueHmiNetworkSync("paused", "pause");
  gHoldPowerResume = true;
  Serial.println("[session] power restored — last drying is PAUSED");
}

/** Drain keypad several times — never block the UI behind HTTPS. */
static void serviceLocalHmiKeys() {
#if ENABLE_LOCAL_HMI
  for (int i = 0; i < 8; i++) {
    LocalHmi::poll();
  }
#endif
}

static void queueHmiNetworkSync(const char* rtdbStatus, const char* apiAction) {
  if (rtdbStatus && rtdbStatus[0]) {
    gDeferredRtdbStatus = rtdbStatus;
    // A Stop must not be followed by a Start that was still waiting to upload.
    if (strcmp(rtdbStatus, "stopped") == 0) {
      gDeferredApiAction = "";
    }
  }
  if (apiAction && apiAction[0]) {
    gDeferredApiAction = apiAction;
  }
}

static void flushHmiNetworkSync() {
  static unsigned long sLastFlushMs = 0;
  if (sLastFlushMs != 0 && (millis() - sLastFlushMs) < 1500UL) {
    return;
  }
  if (!gDeferredRtdbStatus.length() && !gDeferredApiAction.length()) {
    return;
  }
  if (!LocalHmi::keySettledForSync()) return;
  sLastFlushMs = millis();
  if (gDeferredRtdbStatus.length()) {
    String want = gDeferredRtdbStatus;
    want.toLowerCase();
    const char* nowSt = sessionStatusIsRunning() ? "running"
        : (sessionStatusIsPaused() ? "paused" : "stopped");
    if (!want.equals(nowSt)) {
      Serial.println("[hmi] drop stale sync — shared command changed the session");
      gDeferredRtdbStatus = "";
      if (gDeferredApiAction == "start" && !sessionStatusIsRunning()) {
        gDeferredApiAction = "";
      }
    } else if (publishLocalSessionToRtdb(gDeferredRtdbStatus.c_str())) {
      gDeferredRtdbStatus = "";
    }
    serviceLocalHmiKeys();
  }
  if (gDeferredApiAction.length()) {
    const String act = gDeferredApiAction;
    if ((act == "pause" || act == "stop") && !gLocalApiStartAck) {
      if (postLocalSessionAction("start")) {
        gLocalApiStartAck = true;
      } else {
        serviceLocalHmiKeys();
        return;
      }
    }
    if (postLocalSessionAction(act.c_str())) {
      if (act == "start") gLocalApiStartAck = true;
      gDeferredApiAction = "";
    }
    serviceLocalHmiKeys();
  }
}

/** Phone wrote a newer command. Obey it instead of putting the board's copy on top. */
static bool adoptSharedCloudCommand(int mid) {
  if (mid <= 0 || WiFi.status() != WL_CONNECTED) return false;
  const String body = rtdbGetText(String("machines/") + String(mid) + "/command", 400);
  if (body.length() == 0 || body == "null") return false;
  const unsigned long seq = (unsigned long)parseJsonFloatAfterKey(body, "seq", 0);
  if (seq == 0 || seq == gLastCommandSeq || seq == gSeqAtLocalStart ||
      seq == gBoardPublishedSeq) {
    return false;
  }
  String action = parseJsonStringAfterKey(body, "action", "");
  action.toLowerCase();
  action.trim();
  if (action != "start" && action != "pause" && action != "stop") return false;
  Serial.println("[command] phone start/pause/stop wins");
  applyCloudCommandFromRtdb(mid, 400);
  return true;
}

static bool publishLocalSessionToRtdb(const char* statusWordIn) {
  const int mid = sessionMachineId();
  if (mid <= 0) return false;
  if (WiFi.status() != WL_CONNECTED) return false;
  if (adoptSharedCloudCommand(mid)) return true;

  String st = statusWordIn ? String(statusWordIn) : String("stopped");
  st.toLowerCase();
  st.trim();
  const bool running = (st == "running");
  const bool paused = (st == "paused");
  const char* cmd = running ? "start" : (paused ? "pause" : "stop");

  String fish = gLocalFishType;
  fish.replace("\\", "\\\\");
  fish.replace("\"", "\\\"");

  unsigned long seq = millis();
  if (seq == 0 || seq == gLastCommandSeq || seq == gSeqAtLocalStart) seq += 1;

  String sessionJson = "{";
  sessionJson += "\"status\":\"";
  sessionJson += st;
  sessionJson += "\",\"command\":\"";
  sessionJson += cmd;
  sessionJson += "\",\"session_active\":";
  sessionJson += running ? "true" : "false";
  sessionJson += ",\"fault_buzzer_armed\":";
  sessionJson += running ? "true" : "false";
  sessionJson += ",\"moisture_check_armed\":";
  sessionJson += paused ? "true" : "false";
  sessionJson += ",\"fan_speed\":";
  sessionJson += gFanSpeedLevel < 1 ? 1 : gFanSpeedLevel;
  sessionJson += ",\"target_temperature\":";
  sessionJson += String(gSessionTargetC > 1.0f ? gSessionTargetC : 60.0f, 1);
  sessionJson += ",\"fish_type\":\"";
  sessionJson += fish;
  sessionJson += "\",\"total_fish\":";
  sessionJson += gLocalTotalFish;
  sessionJson += ",\"set_duration_minutes\":";
  sessionJson += gLocalDurationMin < 1 ? 1 : gLocalDurationMin;
  sessionJson += ",\"remaining_sec\":";
  {
    long rem = hmiRemainingDurationSec();
    if (rem < 0) rem = 0;
    sessionJson += rem;
  }
  sessionJson += ",\"source\":\"local_hmi\"";
  if (gLocalOfflineId.length()) {
    sessionJson += ",\"offline_id\":\"";
    sessionJson += gLocalOfflineId;
    sessionJson += "\"";
  }
  sessionJson += ",\"updated_at\":{\".sv\":\"timestamp\"}}";

  String cmdJson = "{";
  cmdJson += "\"action\":\"";
  cmdJson += cmd;
  cmdJson += "\",\"fan_speed\":";
  cmdJson += gFanSpeedLevel < 1 ? 1 : gFanSpeedLevel;
  cmdJson += ",\"target_temperature\":";
  cmdJson += String(gSessionTargetC > 1.0f ? gSessionTargetC : 60.0f, 1);
  cmdJson += ",\"fish_type\":\"";
  cmdJson += fish;
  cmdJson += "\",\"total_fish\":";
  cmdJson += gLocalTotalFish;
  cmdJson += ",\"set_duration_minutes\":";
  cmdJson += gLocalDurationMin < 1 ? 1 : gLocalDurationMin;
  cmdJson += ",\"remaining_sec\":";
  {
    long rem = hmiRemainingDurationSec();
    if (rem < 0) rem = 0;
    cmdJson += rem;
  }
  cmdJson += ",\"seq\":";
  cmdJson += seq;
  cmdJson += ",\"source\":\"local_hmi\"";
  cmdJson += ",\"updated_at\":\"";
  cmdJson += String(seq);
  cmdJson += "\"}";

  const bool cmdOk = rtdbPutJsonQuick(
      String("machines/") + String(mid) + "/command", cmdJson);
  const bool sessOk = rtdbPutJsonQuick(
      String("machines/") + String(mid) + "/session", sessionJson);
  if (cmdOk) {
    gLastCommandSeq = seq;
    gBoardPublishedSeq = seq;
    gLastAppliedCommandAction = String(cmd);
    gLastCommandUpdated = String(seq);
  }
  if (cmdOk && sessOk) {
    Serial.printf("[hmi] RTDB session %s published mid=%d\n", st.c_str(), mid);
    return true;
  }
  Serial.printf("[hmi] RTDB session %s PUT failed cmd=%d sess=%d\n",
                st.c_str(), cmdOk ? 1 : 0, sessOk ? 1 : 0);
  return false;
}

struct MoistureSpotRec {
  uint8_t batch;
  uint8_t fish;
  uint8_t pct;
};
static MoistureSpotRec gMoistureSpots[16];
static uint8_t gMoistureSpotCount = 0;
static uint8_t gMoistureBatchSerial = 0;

bool hmiMoistureProbeReady() {
  if (!gMoistureConnected || gLiveMoisturePct < 0 || gLiveMoisturePct > 100) return false;
  if (gMoistureSpreadCached >= 2000) return false;
  return true;
}

int hmiMoistureLivePercent() {
  return hmiMoistureProbeReady() ? gLiveMoisturePct : -1;
}

int hmiNextMoistureBatchNo() {
  return (int)gMoistureBatchSerial + 1;
}

int hmiBeginMoistureBatch() {
  if (gMoistureBatchSerial < 250) gMoistureBatchSerial++;
  return (int)gMoistureBatchSerial;
}

void hmiRememberMoistureSpot(int batchNo, int fishNo, int pct) {
  if (batchNo < 1 || fishNo < 1 || pct < 0 || pct > 100) return;
  if (gMoistureSpotCount >= 16) return;
  gMoistureSpots[gMoistureSpotCount].batch = (uint8_t)batchNo;
  gMoistureSpots[gMoistureSpotCount].fish = (uint8_t)fishNo;
  gMoistureSpots[gMoistureSpotCount].pct = (uint8_t)pct;
  gMoistureSpotCount++;
  Serial.printf("[hmi] spot batch %d fish %d = %d%%\n", batchNo, fishNo, pct);
}

void hmiCancelEmptyMoistureBatch(int batchNo) {
  if (batchNo < 1) return;
  for (uint8_t i = 0; i < gMoistureSpotCount; i++) {
    if (gMoistureSpots[i].batch == (uint8_t)batchNo) return;
  }
  if (gMoistureBatchSerial == (uint8_t)batchNo && gMoistureBatchSerial > 0) {
    gMoistureBatchSerial--;
  }
}

static void clearMoistureSpots() {
  gMoistureSpotCount = 0;
  gMoistureBatchSerial = 0;
}

static String buildLocalSessionPayload(const char* action) {
  const int mid = sessionMachineId();
  String fish = gLocalFishType;
  fish.replace("\\", "\\\\");
  fish.replace("\"", "\\\"");

  String payload = "{";
  payload += "\"action\":\"";
  payload += action;
  payload += "\"";
  if (mid > 0) {
    payload += ",\"microcontroller_id\":";
    payload += mid;
  }
  payload += ",\"mac\":\"";
  payload += gDeviceMac;
  payload += "\"";
  payload += ",\"device_id\":\"";
  payload += gDeviceName;
  payload += "\"";
  payload += ",\"fish_type\":\"";
  payload += fish;
  payload += "\"";
  payload += ",\"total_fish\":";
  payload += gLocalTotalFish;
  payload += ",\"target_temperature\":";
  payload += String(gSessionTargetC > 1.0f ? gSessionTargetC : 60.0f, 1);
  payload += ",\"fan_speed\":";
  payload += gFanSpeedLevel < 1 ? 1 : gFanSpeedLevel;
  payload += ",\"set_duration_minutes\":";
  payload += gLocalDurationMin < 1 ? 1 : gLocalDurationMin;
  payload += ",\"drying_time_seconds\":";
  payload += (int)localHmiElapsedSeconds();
  if (gLocalOfflineId.length() > 0) {
    payload += ",\"offline_id\":\"";
    payload += gLocalOfflineId;
    payload += "\"";
  }
  if (!isnan(cachedDhtT)) {
    payload += ",\"temperature\":";
    payload += String(cachedDhtT, 1);
  }
  if (strcmp(action, "stop") == 0 && gMoistureSpotCount > 0) {
    payload += ",\"moisture_checks\":[";
    for (uint8_t i = 0; i < gMoistureSpotCount; i++) {
      if (i) payload += ",";
      payload += "{\"check_label\":\"Batch ";
      payload += (int)gMoistureSpots[i].batch;
      payload += " \xC2\xB7 Fish ";
      payload += (int)gMoistureSpots[i].fish;
      payload += "\",\"moisture\":";
      payload += (int)gMoistureSpots[i].pct;
      payload += "}";
    }
    payload += "]";
    payload += ",\"moisture\":";
    payload += (int)gMoistureSpots[gMoistureSpotCount - 1].pct;
  }
  payload += "}";
  return payload;
}

static String buildLocalHistoryPayload() {
  return buildLocalSessionPayload("stop");
}

static bool postHistoryPayload(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  WiFiClient client;
  client.setTimeout(4);
  http.setTimeout(4000);
  http.setConnectTimeout(2500);
  const String sessionUrl = laravelSessionUrl();
  if (sessionUrl.length() == 0) return false;
  if (!http.begin(client, sessionUrl)) {
    Serial.println("[hmi] history http.begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  Serial.print("[hmi] SAVE SESSION ");
  Serial.println(payload);
  const int code = http.POST(payload);
  String resp;
  if (code > 0) {
    resp = http.getString();
  }
  http.end();
  Serial.print("[hmi] session HTTP ");
  Serial.print(code);
  Serial.print(" ");
  Serial.println(resp);
  return code >= 200 && code < 300;
}

static void hmiHistSlotKey(uint8_t i, char* out, size_t n) {
  snprintf(out, n, "h%u", (unsigned)i);
}

static String newLocalOfflineId() {
  char buf[28];
  snprintf(buf, sizeof(buf), "%lu%04lu",
           (unsigned long)millis(),
           (unsigned long)(esp_random() % 10000UL));
  return String(buf);
}

/** Pull `"offline_id":"..."` out of a queued local-session JSON body. */
static String payloadOfflineId(const String& payload) {
  const char* key = "\"offline_id\":\"";
  const int at = payload.indexOf(key);
  if (at < 0) return "";
  const int start = at + (int)strlen(key);
  const int end = payload.indexOf('"', start);
  if (end < 0) return "";
  return payload.substring(start, end);
}

static void histQKey(uint8_t i, char* out, size_t n) {
  snprintf(out, n, "q%u", (unsigned)i);
}

static uint8_t histQueueCount() {
  gPrefs.begin("fdhmi", true);
  uint8_t n = (uint8_t)gPrefs.getUChar("qn", 0);
  if (n == 0 && gPrefs.getString("pend", "").length() > 0) n = 1;
  gPrefs.end();
  return n > HMI_HIST_QUEUE_MAX ? (uint8_t)HMI_HIST_QUEUE_MAX : n;
}

static void migratePendIntoQueue() {
  static bool done = false;
  if (done) return;
  done = true;
  gPrefs.begin("fdhmi", false);
  uint8_t n = (uint8_t)gPrefs.getUChar("qn", 0);
  const String pend = gPrefs.getString("pend", "");
  if (n == 0 && pend.length()) {
    gPrefs.putString("q0", pend);
    gPrefs.putUChar("qn", 1);
  }
  gPrefs.remove("hist");
  gPrefs.end();
  gHistPending = histQueueCount() > 0 ? 1 : 0;
}

static void markLocalHistorySynced(const String& offlineId) {
  (void)offlineId;
  gPrefs.begin("fdhmi", false);
  uint8_t n = (uint8_t)gPrefs.getUChar("qn", 0);
  if (n == 0) {
    gPrefs.remove("pend");
    gPrefs.end();
    gHistPending = 0;
    return;
  }
  for (uint8_t i = 0; i + 1 < n && i + 1 < HMI_HIST_QUEUE_MAX; i++) {
    char a[8], b[8];
    histQKey(i, a, sizeof(a));
    histQKey(i + 1, b, sizeof(b));
    gPrefs.putString(a, gPrefs.getString(b, ""));
  }
  char last[8];
  histQKey(n - 1, last, sizeof(last));
  gPrefs.remove(last);
  gPrefs.putUChar("qn", (uint8_t)(n - 1));
  gPrefs.remove("pend");
  gPrefs.end();
  gHistPending = (n > 1) ? 1 : 0;
}

static bool localHistoryAlreadySynced(const String& offlineId) {
  (void)offlineId;
  return false;
}

static void queueLocalHistoryPayload(const String& payload) {
  if (!payload.length()) return;
  migratePendIntoQueue();
  const String offlineId = payloadOfflineId(payload);
  gPrefs.begin("fdhmi", false);
  uint8_t n = (uint8_t)gPrefs.getUChar("qn", 0);
  if (n > HMI_HIST_QUEUE_MAX) n = HMI_HIST_QUEUE_MAX;
  for (uint8_t i = 0; i < n; i++) {
    char k[8];
    histQKey(i, k, sizeof(k));
    const String existing = gPrefs.getString(k, "");
    if (offlineId.length() && payloadOfflineId(existing) == offlineId) {
      gPrefs.putString(k, payload);
      gPrefs.end();
      gHistPending = 1;
      gHistFlushNow = true;
      Serial.println("[hmi] local session queue updated");
      return;
    }
  }
  if (n >= HMI_HIST_QUEUE_MAX) {
    for (uint8_t i = 0; i + 1 < HMI_HIST_QUEUE_MAX; i++) {
      char a[8], b[8];
      histQKey(i, a, sizeof(a));
      histQKey(i + 1, b, sizeof(b));
      gPrefs.putString(a, gPrefs.getString(b, ""));
    }
    n = HMI_HIST_QUEUE_MAX - 1;
  }
  char k[8];
  histQKey(n, k, sizeof(k));
  gPrefs.putString(k, payload);
  gPrefs.putUChar("qn", (uint8_t)(n + 1));
  gPrefs.remove("pend");
  gPrefs.end();
  gHistPending = 1;
  gHistFlushNow = true;
  Serial.printf("[hmi] local session queued (%u)\n", (unsigned)(n + 1));
}

static void flushQueuedLocalHistory() {
  static bool wifiWasUp = false;
  const bool wifiUp = WiFi.status() == WL_CONNECTED;
  const bool justOnline = wifiUp && !wifiWasUp;
  wifiWasUp = wifiUp;
  if (!wifiUp) return;
  migratePendIntoQueue();
  if (gHistPending == 0) return;
  if (gLaravelApiBase.length() == 0) {
    refreshLaravelBaseFromRtdb();
    if (gLaravelApiBase.length() == 0) return;
  }
  static unsigned long lastTryMs = 0;
  if (!gHistFlushNow && !justOnline && lastTryMs != 0 && (millis() - lastTryMs) < 4000UL) {
    return;
  }
  gHistFlushNow = false;
  lastTryMs = millis();

  gPrefs.begin("fdhmi", true);
  uint8_t n = (uint8_t)gPrefs.getUChar("qn", 0);
  String payload = n > 0 ? gPrefs.getString("q0", "") : gPrefs.getString("pend", "");
  gPrefs.end();
  if (!payload.length()) {
    gHistPending = 0;
    return;
  }
  if (!postHistoryPayload(payload)) {
    gHistPending = 1;
    refreshLaravelBaseFromRtdb();
    Serial.println("[hmi] history sync failed — still queued");
    return;
  }
  markLocalHistorySynced(payloadOfflineId(payload));
  Serial.println("[hmi] local session synced to History");
  serviceLocalHmiKeys();
}

static bool postLocalSessionAction(const char* action) {
  const String payload = buildLocalSessionPayload(action);
  if (postHistoryPayload(payload)) return true;
  // Only a finished local session belongs in the history queue.
  if (strcmp(action, "stop") == 0) {
    queueLocalHistoryPayload(payload);
  }
  return false;
}

static bool postLocalHistoryOnStopOnly() {
  return postLocalSessionAction("stop");
}

void hmiOnStartDrying(const String& fishType, int totalFish, float targetC,
                      int durationSec, int fanSpeed) {
  gLocalFishType = fishType;
  gLocalTotalFish = totalFish;
  gLocalDurationSec = durationSec < 1 ? 1 : durationSec;
  gLocalDurationMin = (gLocalDurationSec + 59) / 60;  // history field (ceil minutes)
  gSessionTargetC = targetC;
  gFanSpeedLevel = fanSpeed < 1 ? 1 : (fanSpeed > 3 ? 3 : fanSpeed);
  gLocalHmiOwned = true;
  gKeypadOwnsHistory = true;
  gSeqAtLocalStart = gLastCommandSeq;
  gLocalHmiStartGuardMs = millis();
  gLocalOfflineId = newLocalOfflineId();
  gStopReason[0] = 0;
  gLocalApiStartAck = false;
  clearMoistureSpots();
  gLocalRunAccumMs = 0;
  gLocalRunSegmentStartMs = millis();
  remainSet(gLocalDurationSec);
  gIgnoreStaleRunningUntilMs = 0;
  // LCD/relays first — cloud sync is deferred so Enter feels instant.
  beginDryingOutputs(true);
  persistActiveSession();
  gNeedStatePublish = true;
  queueHmiNetworkSync("running", "start");
  Serial.printf("[hmi] LOCAL start duration=%ds (sync deferred)\n", gLocalDurationSec);
}

void hmiOnPauseDrying() {
  if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
    gLocalRunAccumMs += (millis() - gLocalRunSegmentStartMs);
    gLocalRunSegmentStartMs = 0;
  }
  enterPausedSession();
  gLocalHmiStartGuardMs = millis();
  queueHmiNetworkSync("paused", "pause");
  Serial.println("[hmi] LOCAL pause — moisture check, then parameters");
}

void hmiOnResumeDrying(const String& fishType, int totalFish, float targetC,
                      int remainingSec, int fanSpeed) {
  gLocalFishType = fishType;
  gLocalTotalFish = totalFish;
  gSessionTargetC = targetC;
  gFanSpeedLevel = fanSpeed < 1 ? 1 : (fanSpeed > 3 ? 3 : fanSpeed);
  const unsigned long elapsed = localHmiElapsedSeconds();
  const int rem = remainingSec < 1 ? 1 : remainingSec;
  gLocalDurationSec = (int)elapsed + rem;
  gLocalDurationMin = (gLocalDurationSec + 59) / 60;
  remainSet(rem);
  gLocalRunSegmentStartMs = millis();
  gSeqAtLocalStart = gLastCommandSeq;
  gLocalHmiStartGuardMs = millis();
  beginDryingOutputs(true);
  persistActiveSession();
  gNeedStatePublish = true;
  queueHmiNetworkSync("running", "start");
  Serial.println("[hmi] LOCAL resume (sync deferred)");
}

void hmiOnStopDrying() {
  if (!gStopReason[0]) {
    strncpy(gStopReason, "user", sizeof(gStopReason) - 1);
    gStopReason[sizeof(gStopReason) - 1] = 0;
  }
  if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
    gLocalRunAccumMs += (millis() - gLocalRunSegmentStartMs);
    gLocalRunSegmentStartMs = 0;
  }
  const bool hadLocal = gLocalHmiOwned || sessionStatusIsRunning() || sessionStatusIsPaused() ||
                        gLocalFishType.length() > 0;
  String historyPayload;
  if (hadLocal) {
    historyPayload = buildLocalSessionPayload("stop");
  }
  const String fish = gLocalFishType;
  const int total = gLocalTotalFish;
  const int dur = gLocalDurationMin;
  const int durSec = gLocalDurationSec;
  const float target = gSessionTargetC;
  const int fan = gFanSpeedLevel;
  forceIdleSessionState();
  gLocalFishType = fish;
  gLocalTotalFish = total;
  gLocalDurationMin = dur;
  gLocalDurationSec = durSec;
  gSessionTargetC = target;
  gFanSpeedLevel = fan;
  if (gKeypadOwnsHistory && historyPayload.length()) {
    queueLocalHistoryPayload(historyPayload);
  }
  clearMoistureSpots();
  gKeypadOwnsHistory = false;
  // RTDB for the app; Laravel history comes from the NVS queue (retry until 200).
  queueHmiNetworkSync("stopped", nullptr);
  gLocalHmiStartGuardMs = millis();
  gIgnoreCloudStartUntilMs = millis() + 5000UL;
  Serial.println("[hmi] stop — UI instant; history queued");
}

void hmiOnDurationComplete() {
  Serial.println("[hmi] duration complete — last moisture batch, then save");
  strncpy(gStopReason, "duration", sizeof(gStopReason) - 1);
  gStopReason[sizeof(gStopReason) - 1] = 0;
  if (sessionStatusIsRunning() || sessionStatusIsPaused()) {
    enterPausedSession();
    queueHmiNetworkSync("paused", nullptr);
  }
}

bool hmiSessionIsRunning() { return sessionStatusIsRunning(); }
bool hmiSessionIsPaused() { return sessionStatusIsPaused(); }
float hmiLiveTemperatureC() { return cachedDhtT; }
float hmiLiveHumidity() { return cachedDhtH; }
void hmiFormatDryingProblem(char* out, size_t outSz) {
  if (!out || outSz == 0) return;
  snprintf(out, outSz, "%s", gDryingProblemLine);
}
bool hmiHasDryingProblem() {
  return gDryingProblemLine[0] != 0 && strcmp(gDryingProblemLine, "None") != 0;
}

bool hmiDht22NotWorking() {
  return !lastDhtReadOk;
}

bool hmiDoorIsOpen() {
  bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
  readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);
  return doorOk && doorOpen;
}

bool hmiLocalDurationExpired() {
  if (!sessionStatusIsRunning()) return false;
  if (gLocalHmiStartGuardMs != 0 &&
      (millis() - gLocalHmiStartGuardMs) < 3000UL &&
      gLocalDurationSec > 2) {
    return false;
  }
  remainCatchUp();
  return gRemainSec <= 0;
}

long hmiRemainingDurationSec() {
  if (sessionStatusIsRunning()) remainCatchUp();
  if (gRemainSec < 1 && gLocalDurationSec > 1 &&
      gLocalHmiStartGuardMs != 0 &&
      (millis() - gLocalHmiStartGuardMs) < 3000UL) {
    return gLocalDurationSec;
  }
  return gRemainSec < 0 ? 0 : gRemainSec;
}

/** Serial: 1=all ON, 0=all OFF, h=heater only 60s (wiring test, no app). */
static void pollSerialBenchOverride() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '1') {
      gDryingOutputsLatched = true;
      gSessionStatus = "running";
      gSessionTargetC = 60.0f;
      gSessionActiveFlag = true;
      applyDryingOutputsHard();
      Serial.println("[BENCH] Serial 1 — fan+heaters ON, loud buzzer 1.2s");
      gDryRunAuthorized = true;
      buzzerChirpLoudBlocking(1200);
      applyDryingOutputsHard();
      Serial.print("[BENCH] heater cmd=");
      Serial.print(sHeaterCommandedOn ? 1 : 0);
      Serial.print(" gpio19=");
      Serial.println(digitalRead(RELAY_HEATER1));
    } else if (c == 'h' || c == 'H') {
      Serial.println("[BENCH] heater ONLY 60s — SSR indicator must light");
      driveHeaterLoad(true);
      Serial.print("[BENCH] cmdOn=");
      Serial.print(sHeaterCommandedOn ? 1 : 0);
      Serial.print(" gpio19=");
      Serial.println(digitalRead(RELAY_HEATER1));
      const unsigned long end = millis() + 60000UL;
      while ((long)(end - millis()) > 0) {
        driveHeaterLoad(true);
        delay(50);
        yield();
      }
      driveHeaterLoad(false);
      Serial.println("[BENCH] heater OFF");
    } else if (c == '0') {
      forceIdleSessionState();
      Serial.println("[BENCH] Serial 0 — all outputs OFF");
    }
  }
}

void loop() {
  pollSerialBenchOverride();

#if ENABLE_LOCAL_HMI
  serviceLocalHmiKeys();
#endif

  connectWifiNonBlocking();

  bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
  readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);
  applySessionLedsOnly();
  commitLoadRelays(dhtOk, cachedDhtT);
#if ENABLE_RTDB_HARDWARE_TEST
  if (!gDryingOutputsLatched) {
    tickHardwareTestOutputs();
  }
#endif
  serviceBuzzer(dhtOk, moistureOk, doorOk, doorOpen, cachedDhtT);
  safetyCutLoadsUnlessRunning();
  serviceLocalHmiKeys();

  if (sessionStatusIsRunning()) {
    static unsigned long lastSessSaveMs = 0;
    if (lastSessSaveMs == 0 || (millis() - lastSessSaveMs) >= 15000UL) {
      lastSessSaveMs = millis();
      persistActiveSession();
    }
  }
  if (sessionStatusIsRunning()) remainCatchUp();
  gLiveTempC = cachedDhtT;
  gLiveHum = cachedDhtH;

  const bool sessionLive = sessionStatusIsRunning() || sessionStatusIsPaused();

  // A key that was just pressed gets one short turn so the character paints.
  // Heartbeat, Start/Pause/Stop, and hardware tests keep running on every
  // other screen — including STOP/PAUSE and parameter entry.
  const bool keyBurst =
      !LocalHmi::uiSelfTestActive() &&
      (LocalHmi::blockNetworkForKey() || LocalHmi::keyQueued());
  const bool screenQuiet =
      LocalHmi::isEnteringParams() && !LocalHmi::uiSelfTestActive();
  const unsigned long bodyPollMs = sessionLive ? 8000UL : SESSION_BODY_POLL_MS;
  const bool syncDue =
      (gDeferredRtdbStatus.length() || gDeferredApiAction.length()) &&
      LocalHmi::keySettledForSync();

  // One Firebase request per loop, on a kept TLS socket.
  if (WiFi.status() == WL_CONNECTED) {
    const unsigned long now = millis();
    const unsigned long cmdAge =
        (gLastSessionPollMs == 0) ? 60000UL : (now - gLastSessionPollMs);
    const unsigned long testAge =
        (gLastTestCmdPollMs == 0) ? 60000UL : (now - gLastTestCmdPollMs);
    const unsigned long presenceAge =
        (gLastPresenceOkMs == 0) ? 60000UL : (now - gLastPresenceOkMs);
    const bool dryingNow = gDryingOutputsLatched || sessionStatusIsRunning();
    const bool idle = !sessionLive && !dryingNow;
    const bool canTest =
    #if ENABLE_RTDB_HARDWARE_TEST
        !dryingNow && !sessionStatusIsPaused();
    #else
        false;
    #endif
    // Idle still pulses on the same 2s cadence as a drying run. A tighter
    // idle pulse was starving Start/Pause and the hardware-test Done read.
    const unsigned long testPollMs = hardwareTestActive() ? 200UL : (idle ? 5000UL : 800UL);
    const unsigned long cmdInterval = idle ? 2500UL : 400UL;
    const bool cmdDue = cmdAge >= cmdInterval;
    const bool testDue = canTest && testAge >= testPollMs;
    const bool presenceDue = presenceAge >= PRESENCE_INTERVAL_MS;
    const bool presenceAttemptOk =
        gLastPresenceAttemptMs == 0 || (now - gLastPresenceAttemptMs) >= 400UL;
    const bool fullDue =
        lastHeartbeatMs == 0 || (now - lastHeartbeatMs) >= HEARTBEAT_INTERVAL_MS;
    const bool presenceLate = presenceAge >= 2500UL;
    const bool bodyDue = !presenceLate && !hardwareTestActive() && !screenQuiet &&
        (gLastSessionBodyPollMs == 0 || (now - gLastSessionBodyPollMs) >= bodyPollMs);
    const bool lanDue = !presenceLate && !screenQuiet && gLastBeatOk &&
        (gLaravelApiBase.length() == 0 || !sessionLive) &&
        (gLastLanPollMs == 0 || (now - gLastLanPollMs) > 60000UL);
    const unsigned long assignmentPollMs =
        gAssignedId > 0 ? ASSIGNMENT_POLL_ASSIGNED_MS : ASSIGNMENT_POLL_UNASSIGNED_MS;
    const bool assignDue = !presenceLate && !screenQuiet && !sessionLive && gLastBeatOk &&
        (gLastAssignmentPollMs == 0 || (now - gLastAssignmentPollMs) >= assignmentPollMs);
    const bool interactiveFresh = !presenceDue && !presenceLate &&
        (idle || (cmdAge < 800UL && (!canTest || testAge < 800UL)));

    bool pickCommand = false;
    bool pickTest = false;
    bool pickPulse = false;
    bool pickHb = false;
    bool pickState = false;
    bool pickSync = false;
    bool pickBody = false;
    bool pickLan = false;
    bool pickAssign = false;

    // Done/X and a keypad Pause/Resume must not wait behind the online pulse.
    const bool testStopDue =
        hardwareTestActive() && testDue && !keyBurst && testAge >= 700UL;
    if (testStopDue) {
      pickTest = true;
    } else if (!keyBurst && !presenceLate && syncDue && gDeferredRtdbStatus.length()) {
      pickSync = true;
    } else if (presenceDue && presenceAttemptOk && !keyBurst) {
      pickPulse = true;
    } else if (hardwareTestActive() && testDue && !keyBurst) {
      pickTest = true;
    } else if (!keyBurst && !presenceLate && fullDue) {
      pickHb = true;
    } else if (!keyBurst && !presenceLate && cmdDue) {
      pickCommand = true;
    } else if (!keyBurst && !presenceLate && testDue) {
      pickTest = true;
    } else if (interactiveFresh && !hardwareTestActive() && gNeedStatePublish) {
      pickState = true;
    } else if (interactiveFresh && !hardwareTestActive() && syncDue) {
      pickSync = true;
    } else if (interactiveFresh && bodyDue) {
      pickBody = true;
    } else if (interactiveFresh && lanDue) {
      pickLan = true;
    } else if (interactiveFresh && assignDue) {
      pickAssign = true;
    }

    auto doHeartbeat = [&]() {
      gLastPresenceAttemptMs = millis();
      gLastBeatOk = sendHeartbeat(dhtOk, moistureOk, doorOk);
      lastHeartbeatMs = millis();
      gLastPresenceFailed = !gLastBeatOk;
      if (gLastBeatOk) gLastPresenceOkMs = millis();
      commitLoadRelays(pollDhtIfDue(), cachedDhtT);
      safetyCutLoadsUnlessRunning();
    #if ENABLE_RTDB_HARDWARE_TEST
      holdHardwareTestActuators();
    #endif
    };

    if (pickPulse) {
      gLastPresenceAttemptMs = millis();
      const bool pulseOk = sendPresencePulse();
      gLastPresenceFailed = !pulseOk;
      if (pulseOk) gLastBeatOk = true;
      serviceLocalHmiKeys();
    } else if (pickCommand) {
      applyCloudCommandFromRtdb(sessionMachineId(), 600);
      gLastSessionPollMs = millis();
      serviceLocalHmiKeys();
    } else if (pickTest) {
      refreshTestCommandFromCloud();
      gLastTestCmdPollMs = millis();
      serviceLocalHmiKeys();
    } else if (pickHb) {
      doHeartbeat();
      serviceLocalHmiKeys();
    } else if (pickState) {
      const char* st = sessionStatusIsRunning() ? "running"
          : (sessionStatusIsPaused() ? "paused" : "stopped");
      (void)publishLocalSessionToRtdb(st);
      gNeedStatePublish = false;
      serviceLocalHmiKeys();
    } else if (pickSync) {
      flushHmiNetworkSync();
      serviceLocalHmiKeys();
    } else if (pickBody) {
      gLastSessionBodyPollMs = millis();
      refreshSessionFromCloud(false);
      gLastSessionBodyPollMs = millis();
      serviceLocalHmiKeys();
    } else if (pickLan) {
      gLastLanPollMs = millis();
      refreshLaravelBaseFromRtdb();
      serviceLocalHmiKeys();
    } else if (pickAssign) {
      gLastAssignmentPollMs = millis();
      if (refreshAssignmentFromCloud()) {
        Serial.print("[assignment] active id=");
        Serial.println(gAssignedId);
      }
      serviceLocalHmiKeys();
    }
  }

#if ENABLE_LOCAL_HMI
  if (!keyBurst && !screenQuiet && LocalHmi::canFlushOfflineHistory() && LocalHmi::keySettledForSync()) {
    flushQueuedLocalHistory();
  }
  serviceLocalHmiKeys();
#endif
  delay(2);
}

