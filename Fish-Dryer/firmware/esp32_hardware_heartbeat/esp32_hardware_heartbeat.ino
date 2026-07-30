      #include <WiFi.h>
      #include <HTTPClient.h>
      #include <WiFiClientSecure.h>
      #include <Preferences.h>
      #include "DHT.h"
      #include <time.h>
      #if defined(ESP32)
      #include "esp_system.h"
      #include "esp_task_wdt.h"
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

      /** Local LCD/keypad owns the session (machine can run without the phone). */
      static bool gLocalHmiOwned = false;
      static String gLocalFishType = "";
      static int gLocalTotalFish = 0;
      static int gLocalDurationMin = 0;
      static int gLocalDurationSec = 0;
      static unsigned long gLocalRunAccumMs = 0;
      static unsigned long gLocalRunSegmentStartMs = 0;

      static void publishLocalSessionToRtdb(const char* statusWordIn);
      static unsigned long localHmiElapsedSeconds();
      static void queueHmiNetworkSync(const char* rtdbStatus, const char* apiAction);
      static void flushHmiNetworkSync();
      static void serviceLocalHmiKeys();
      static bool postLocalSessionAction(const char* action);

      // ===== BUZZER (running session only) =====
      //  Door opened after closed start | DHT22 fault | temp high | temp low 10+ min
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
      /** Below target after this much drying time → temp fault buzzer (10 min). */
      #ifndef TEMP_BELOW_TARGET_AFTER_DRYING_MS
      #define TEMP_BELOW_TARGET_AFTER_DRYING_MS (10UL * 60UL * 1000UL)
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

      // Remote hardware test from mobile → RTDB `machines/{id}/test_command`.
      static String        gTestMode = "";           // "all" | "component" | ""
      static String        gTestComponent = "";
      static String        gLastTestRequestId = "";
      static unsigned long gTestModeUntilMs = 0;
      static unsigned long gLastTestCmdPollMs = 0;
      static unsigned long gLastSessionPollMs = 0;
      static int           gTestFanLevel = 3;
      static const unsigned long ASSIGNMENT_POLL_UNASSIGNED_MS = 1000UL;
      static const unsigned long ASSIGNMENT_POLL_ASSIGNED_MS = 10000UL;
      // Keep session polls sparse — each HTTPS GET freezes the keypad for hundreds of ms.
      static const unsigned long SESSION_POLL_MS = 2000UL;
      static const unsigned long TEST_COMMAND_POLL_MS = 1000UL;
      static const unsigned long RTDB_GET_TIMEOUT_MS = 1200UL;
      static const unsigned long RTDB_GET_CONNECT_TIMEOUT_MS = 800UL;
      static const unsigned long RTDB_PUT_TIMEOUT_MS = 1500UL;
      static const unsigned long RTDB_PUT_CONNECT_TIMEOUT_MS = 800UL;

      // ================= WIFI / API — CHANGE PC IP HERE (must match phone app) =================
      const char* WIFI_SSID = "XuMinghao";
      const char* WIFI_PASS = "Connecthere";

      // PC IPv4 from `ipconfig` + run: php artisan serve --host=0.0.0.0 --port=8000
      // Must match fish-dryer-mobile/app.json -> expo.extra.apiBaseUrl (same IP, ends with /api).
      const char* API_URL = "http://10.124.242.15:8000/api/hardware/esp32/status";
      /** Local LCD/keypad start/pause/stop → Laravel history (same host as API_URL). */
      const char* API_SESSION_URL = "http://10.124.242.15:8000/api/hardware/esp32/session";

      static       const char* FIRMWARE_BUILD_TAG = "fan-gpio22-v67-hmi-snappy";

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
      /** If RTDB rules use legacy auth, paste Database secret here (same as Laravel FIREBASE_DATABASE_SECRET). Leave "" for open rules. */
      const char* FIREBASE_DB_SECRET = "";

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
      // EXACT WIRING (one wire per line):
      //   DHT22 VCC→3.3V  GND→GND  DATA→GPIO4
      //   Moisture VCC→3.3V  GND→GND  AO→GPIO35  (DO pin unconnected)
      //   Reed wire1→GPIO16  wire2→GND  (magnet near = LOW, open = HIGH)
      //   LED green: GPIO32→220Ω→LED+  LED−→GND
      //   LED yellow: GPIO33→220Ω→LED+  LED−→GND
      //   LED red: GPIO13→220Ω→LED+  LED−→GND
      //   Buzzer +: GPIO27→220Ω→+  Buzzer −→GND
      //   Fan relay (1-ch blue module): VCC→5V (NOT 3.3V)  GND→GND  IN→GPIO22  JD-VCC jumper ON
      //     Fan load: COM + NO (normally open). NC only if you want fan on when relay is idle.
      //     Module LED ON = coil energized (IN LOW). Drying = IN HIGH = LED off = fan via NC wiring.
      //     No CLICK but LED changes? Coil lacks 5V — fix VCC/JD-VCC/GND, not the ESP32 code.
      //              COM→switching PSU +  NO→fan red  fan black→PSU −
      //   SSR-60 DA heater (ONE SSR):
      //     AC OUTPUT terminals 1–2: 1→plug LIVE  2→heater wire
      //        (heater return → plug NEUTRAL — not through the SSR)
      //     DC INPUT terminals 3–4: 3(+)→GPIO19  4(−)→GND
      //     GPIO19 HIGH = drying session running. GPIO19 LOW = stopped/paused.
      //     GPIO18 NOT wired unless you add a second SSR.
      #define PIN_DHT22        4
      #define PIN_MOISTURE    35
      #define PIN_DOOR        16    // NOT GPIO15 (strapping — crashes when reed open)
      #define PIN_FAN         22
      #define PIN_HEATER1     19    // SSR DC+ (single heater)
      // GPIO18 is keypad col when ENABLE_LOCAL_HMI — drive H2 on same SSR pin as H1.
      #if ENABLE_LOCAL_HMI
      #define PIN_HEATER2     PIN_HEATER1
      #else
      #define PIN_HEATER2     18    // leave UNWIRED unless you add a 2nd SSR
      #endif
      #define PIN_BUZZER      27
      #define PIN_LED_GREEN   32
      #define PIN_LED_YELLOW  33
      #define PIN_LED_RED     13

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

      // Fan relay IN on GPIO22: HIGH = ON while drying, LOW = OFF when stopped/paused.
      #ifndef RELAY_ACTIVE_LOW
      #define RELAY_ACTIVE_LOW 1
      #endif
      #ifndef FAN_RELAY_ACTIVE_LOW
      #define FAN_RELAY_ACTIVE_LOW 0
      #endif
      /** Float IN like unplugging jumper (ms). */
      #ifndef FAN_RELAY_FLOAT_MS
      #define FAN_RELAY_FLOAT_MS 250
      #endif
      /** Hold ON after reconnect (ms) so relay latches. */
      #ifndef FAN_RELAY_HOLD_MS
      #define FAN_RELAY_HOLD_MS 400
      #endif
      // Heaters on SSR-60DA. If heaters use blue relays like fan, set HEATER_CONTROL_IS_SSR to 0.
      #ifndef HEATER_CONTROL_IS_SSR
      #define HEATER_CONTROL_IS_SSR 1
      #endif
      /** 0 = GPIO19→SSR3(+), GND→SSR4(−). 1 = alternate 5V→SSR3, GPIO19→SSR4. */
      #ifndef HEATER_SSR_SINK_5V
      #define HEATER_SSR_SINK_5V 0
      #endif
      /** 0 = GPIO HIGH when session running, LOW when stopped/paused (this board). */
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
      /** 1 = heater ON entire drying session (same as fan). No thermostat gate. */
      #ifndef HEATER_MIRROR_FAN
      #define HEATER_MIRROR_FAN 1
      #endif
      #ifndef RELAY_BOOT_CLICK_MS
      #define RELAY_BOOT_CLICK_MS 400
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
      #define BUZZER_PWM_DUTY 255
      #endif
      /** 0 = unassigned boards must not publish to machines/1/ until the app assigns them. */
      #ifndef FALLBACK_MACHINE_ID
      #define FALLBACK_MACHINE_ID 0
      #endif
      #ifndef ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT
      #define ALLOW_ACTUATORS_WITHOUT_ASSIGNMENT 0
      #endif
      /** 1 = 3-pin active buzzer (steady HIGH). 0 = passive piezo on GPIO27 (needs PWM/tone). */
      #ifndef BUZZER_ACTIVE_HIGH
      #define BUZZER_ACTIVE_HIGH 0
      #endif
      /** Loud chirp when drying starts. 0 = off. */
      #ifndef BUZZER_DRYING_START_CHIRP_MS
      #define BUZZER_DRYING_START_CHIRP_MS 120
      #endif
      #ifndef SESSION_ACTIVE_HOLD_MS
      #define SESSION_ACTIVE_HOLD_MS 15000UL
      #endif
      /** Beep at boot (proves GPIO27). 0 = off after wiring verified. */
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
      static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody);

      #define DHTTYPE DHT22

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

      /**
       * Mimics unplugging GPIO22 (true hi-z), then driving the target coil level.
       * Wiggling the IN wire works because of float→connected — apply on BOTH on and off.
       */
      static void fanRelayHardKickTo(bool coilOn) {
        const int level = coilOn ? fanRelayLevelOn() : fanRelayLevelOff();
      #if defined(ESP32)
        gpio_reset_pin((gpio_num_t)RELAY_FAN);
        gpio_set_pull_mode((gpio_num_t)RELAY_FAN, GPIO_FLOATING);
        gpio_set_direction((gpio_num_t)RELAY_FAN, GPIO_MODE_INPUT);
        delay((unsigned long)FAN_RELAY_FLOAT_MS);
        gpio_set_direction((gpio_num_t)RELAY_FAN, GPIO_MODE_OUTPUT);
        gpio_set_drive_capability((gpio_num_t)RELAY_FAN, GPIO_DRIVE_CAP_3);
        digitalWrite(RELAY_FAN, level);
      #else
        pinMode(RELAY_FAN, INPUT);
        delay((unsigned long)FAN_RELAY_FLOAT_MS);
        pinMode(RELAY_FAN, OUTPUT);
        digitalWrite(RELAY_FAN, level);
      #endif
        delay((unsigned long)FAN_RELAY_HOLD_MS);
        sFanRelayCoilCommandedOn = coilOn;
        sFanNeedWakePulse = false;
        Serial.print("[fan] reconnect-kick GPIO");
        Serial.print(RELAY_FAN);
        Serial.print(" coilOn=");
        Serial.print(coilOn ? 1 : 0);
        Serial.print(" level=");
        Serial.println(level);
      }

      /** Steady fan drive — state changes use hard kick (ESP32 often needs float edge for relay coil). */
      static inline void driveFanLoad(bool on) {
        const int levelOff = fanRelayLevelOff();
        const int levelOn  = fanRelayLevelOn();
        if (on == sFanRelayCoilCommandedOn && !sFanNeedWakePulse) {
          return;
        }
        if (sFanNeedWakePulse || on != sFanRelayCoilCommandedOn) {
          fanRelayHardKickTo(on);
          return;
        }
        pinMode(RELAY_FAN, OUTPUT);
      #if defined(ESP32)
        gpio_set_drive_capability((gpio_num_t)RELAY_FAN, GPIO_DRIVE_CAP_3);
      #endif
        digitalWrite(RELAY_FAN, on ? levelOn : levelOff);
        sFanRelayCoilCommandedOn = on;
      }

      /** Session start: float + kick so mechanical relay pulls in after idle. */
      static inline void forceFanRelayWakeOn() {
        sFanNeedWakePulse = true;
        fanRelayHardKickTo(true);
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

      /** SSR-60DA: sink = 5V on term 3, GPIO19 open-drain on term 4, LOW = ON. */
      static inline void driveHeaterLoad(bool on) {
        sHeaterCommandedOn = on;
        pinMode(RELAY_HEATER2, OUTPUT);
      #if HEATER_CONTROL_IS_SSR
      #if HEATER_SSR_SINK_5V
      #if defined(ESP32)
        heaterSinkOdInitOnce();
        gpio_set_level((gpio_num_t)RELAY_HEATER1, on ? 0 : 1);
      #else
        pinMode(RELAY_HEATER1, OUTPUT);
        digitalWrite(RELAY_HEATER1, on ? LOW : HIGH);
      #endif
        digitalWrite(RELAY_HEATER2, HIGH);
      #else
        pinMode(RELAY_HEATER1, OUTPUT);
      #if defined(ESP32)
        gpio_set_drive_capability((gpio_num_t)RELAY_HEATER1, GPIO_DRIVE_CAP_3);
      #endif
      #if HEATER_SSR_ACTIVE_LOW
        digitalWrite(RELAY_HEATER1, on ? LOW : HIGH);
        digitalWrite(RELAY_HEATER2, HIGH);
      #else
        digitalWrite(RELAY_HEATER1, on ? HIGH : LOW);
        digitalWrite(RELAY_HEATER2, LOW);
      #endif
      #endif
      #else
        pinMode(RELAY_HEATER1, OUTPUT);
        driveRelay(RELAY_HEATER1, on);
        driveRelay(RELAY_HEATER2, on);
      #endif
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
      /** YL-69: idle until probe touches fish — standby, not a fault. */
      String moistureStatusWord(bool probeConnected) {
        return probeConnected ? "working" : "standby";
      }
      String statusUnknown() { return "unknown"; }

      // ===== Moisture calibration (ADC → %) =====
      // YL-69 on GPIO35: lower ADC = wetter, higher = drier. Swap if water raises ADC.
      #ifndef MOISTURE_YL69_DRY_ADC
      #define MOISTURE_YL69_DRY_ADC 4095
      #endif
      #ifndef MOISTURE_YL69_WET_ADC
      #define MOISTURE_YL69_WET_ADC 1200
      #endif
      #ifndef MOISTURE_LEARNED_SPAN_MIN
      #define MOISTURE_LEARNED_SPAN_MIN 800
      #endif

      static int MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
      static int MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
      static bool moistureBoundsInitialized = false;

      static int clampInt(int v, int lo, int hi) {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
      }

      static void updateMoistureBounds(int adc) {
        if (!moistureBoundsInitialized) {
          MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
          MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
          moistureBoundsInitialized = true;
        }

        // Expand bounds slowly to avoid spikes.
        if (adc > MOISTURE_DRY_ADC) MOISTURE_DRY_ADC = adc;
        if (adc < MOISTURE_WET_ADC) {
          MOISTURE_WET_ADC = adc;
          if (MOISTURE_WET_ADC < 800) MOISTURE_WET_ADC = 800;
        }

        // Keep a minimum span so percent doesn't explode.
        if (abs(MOISTURE_DRY_ADC - MOISTURE_WET_ADC) < 200) {
          MOISTURE_DRY_ADC += 100;
          MOISTURE_WET_ADC -= 100;
          if (MOISTURE_WET_ADC < 800) MOISTURE_WET_ADC = 800;
          if (MOISTURE_DRY_ADC > 4095) MOISTURE_DRY_ADC = 4095;
        }
      }

      static int moisturePercentFromAdc(int adc) {
        int dry = moistureBoundsInitialized ? MOISTURE_DRY_ADC : MOISTURE_YL69_DRY_ADC;
        int wet = moistureBoundsInitialized ? MOISTURE_WET_ADC : MOISTURE_YL69_WET_ADC;
        if (dry == wet) return 0;
        if (dry < wet) {
          const int t = dry;
          dry = wet;
          wet = t;
        }
        float pct = (float)(dry - adc) * 100.0f / (float)(dry - wet);
        return clampInt((int)lroundf(pct), 0, 100);
      }

      #ifndef MOISTURE_ADC_SAMPLES
      #define MOISTURE_ADC_SAMPLES 24
      #endif

      #ifndef MOISTURE_FLOAT_SPREAD_FAIL
      #define MOISTURE_FLOAT_SPREAD_FAIL 1100
      #endif
      #ifndef MOISTURE_FLOAT_LOW_ADC_MAX
      /** Unplugged GPIO35: pegged near 0 with very low spread (not wet fish readings). */
      #define MOISTURE_FLOAT_LOW_ADC_MAX 180
      #endif
      #ifndef MOISTURE_FLOAT_LOW_SPREAD_MAX
      #define MOISTURE_FLOAT_LOW_SPREAD_MAX 150
      #endif
      #ifndef MOISTURE_CONNECT_GOOD_SAMPLES
      #define MOISTURE_CONNECT_GOOD_SAMPLES 2
      #endif
      #ifndef MOISTURE_CONNECT_BAD_SAMPLES
      #define MOISTURE_CONNECT_BAD_SAMPLES 4
      #endif
      #ifndef MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES
      #define MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES 2
      #endif
      /** 0 = moisture faults do not drive buzzer (avoids false alarms from YL-69 thresholds). */
      #ifndef MOISTURE_FAULT_BUZZER
      #define MOISTURE_FAULT_BUZZER 0
      #endif

      static bool gMoistureConnectedStable = false;
      static uint8_t gMoistureGoodStreak = 0;
      static uint8_t gMoistureBadStreak = 0;
      /** Latched ON after RTDB start until explicit stop (survives flaky GETs). */
      static bool gDryingOutputsLatched = false;
      /** Last processed `machines/{id}/command.seq` (mobile + Laravel write here). */
      static unsigned long gLastCommandSeq = 0;
      /** Ignore stale RTDB `running` until this time (prevents fan/heat on at boot). */
      static unsigned long gBootMs = 0;
      static unsigned long gIgnoreStaleRunningUntilMs = 0;
      /** Fan/heat ONLY after app Start (command seq) — not stale RTDB status=running. */
      static bool gDryRunAuthorized = false;

      /**
       * YL-69 A0: wet → low ADC, dry → high. Unplugged GPIO35 often hits 0 (min) with
       * noisy spread 150–400 — must not report fake 60–90% moisture.
       */
      static bool moistureProbeConnected(int avgAdc, int spread, int minAdc, int maxAdc) {
        (void)minAdc;
        if (spread > MOISTURE_FLOAT_SPREAD_FAIL) {
          return false;
        }
        if (maxAdc >= 4040 && minAdc <= 25 && spread < 100) {
          return false;
        }
        if (avgAdc <= 12 && spread < 90) {
          return false;
        }
        if (avgAdc < MOISTURE_FLOAT_LOW_ADC_MAX &&
            spread < MOISTURE_FLOAT_LOW_SPREAD_MAX) {
          return false;
        }
        if (avgAdc > 3950 && spread < 180) {
          return false;
        }
        /** GPIO35: probe connected if ADC is in a sane range (not pegged floating). */
        return avgAdc >= 80 && avgAdc <= 4080 && spread <= 900;
      }

      /** Stable connect/disconnect for RTDB + buzzer (breadboard noise). */
      static bool moistureSensorReportOk(int avgAdc, int spread, int minAdc, int maxAdc) {
        return moistureConnectedDebounced(avgAdc, spread, minAdc, maxAdc);
      }

      static bool moistureHealthOk(int avgAdc, int spread, int minAdc, int maxAdc) {
        return moistureProbeConnected(avgAdc, spread, minAdc, maxAdc);
      }

      static void resetMoistureCalibration() {
        moistureBoundsInitialized = false;
        MOISTURE_DRY_ADC = MOISTURE_YL69_DRY_ADC;
        MOISTURE_WET_ADC = MOISTURE_YL69_WET_ADC;
      }

      /**
       * Debounce connect/disconnect. While connected, a single noisy "good" sample must not
       * reset the disconnect counter (floating GPIO35 causes false "working" for minutes).
       */
      static bool moistureConnectedDebounced(int avgAdc, int spread, int minAdc, int maxAdc) {
        const bool sampleOk = moistureProbeConnected(avgAdc, spread, minAdc, maxAdc);
        if (sampleOk) {
          if (gMoistureGoodStreak < 255) gMoistureGoodStreak++;
          if (!gMoistureConnectedStable) {
            gMoistureBadStreak = 0;
          } else if (gMoistureGoodStreak >= MOISTURE_DISCONNECT_GOOD_RESET_SAMPLES) {
            gMoistureBadStreak = 0;
          }
        } else {
          gMoistureGoodStreak = 0;
          if (gMoistureBadStreak < 255) gMoistureBadStreak++;
        }
        if (!gMoistureConnectedStable &&
            gMoistureGoodStreak >= MOISTURE_CONNECT_GOOD_SAMPLES) {
          gMoistureConnectedStable = true;
          gMoistureBadStreak = 0;
        }
        if (gMoistureConnectedStable &&
            gMoistureBadStreak >= MOISTURE_CONNECT_BAD_SAMPLES) {
          gMoistureConnectedStable = false;
          gMoistureGoodStreak = 0;
          resetMoistureCalibration();
        }
        return gMoistureConnectedStable;
      }

      static void readMoistureAdcOnPin(int pin, int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        (void)analogRead(pin);
        delay(1);
        long sum = 0;
        int minV = 4095;
        int maxV = 0;
        int secondMinV = 4095;
        for (int i = 0; i < MOISTURE_ADC_SAMPLES; i++) {
          const int v = analogRead(pin);
          sum += v;
          if (v < minV) {
            secondMinV = minV;
            minV = v;
          } else if (v < secondMinV) {
            secondMinV = v;
          }
          if (v > maxV) maxV = v;
          delay(2);
        }
        avgOut = (int)(sum / MOISTURE_ADC_SAMPLES);
        spreadOut = maxV - minV;
        minOut = minV;
        maxOut = maxV;
        if (minV <= 15 && secondMinV < 4095 && secondMinV > minV + 8) {
          minOut = secondMinV;
          spreadOut = maxV - minOut;
        }
      }

      static void readMoistureAdc(int& avgOut, int& spreadOut, int& minOut, int& maxOut) {
        readMoistureAdcOnPin(PIN_MOISTURE, avgOut, spreadOut, minOut, maxOut);
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

      static int gLastDoorCapLowSamples = -1;
      static bool gDoorWireLatched = false;
      static uint8_t gDoorBarePinStreak = 0;

      /**
       * Magnet apart and unplugged GPIO both read steady HIGH with INPUT_PULLUP.
       * Discharge the line, then measure how many µs until pull-up wins.
       * MC38 wiring is slower than a bare GPIO16 pin.
       */
      static unsigned long doorWireRiseMicrosAfterHighState() {
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
        pinMode(REED_PIN, INPUT_PULLUP);
        gLastDoorCapLowSamples = (int)(riseUs / 10UL);
        return riseUs;
      }

      static bool doorWirePresentAfterHighState() {
        const unsigned long riseUs = doorWireRiseMicrosAfterHighState();
        return riseUs > DOOR_WIRE_BARE_RISE_US;
      }

      /** MC38 on GPIO16: magnet near (door closed) = LOW, door open = HIGH (see wiring comment). */
      static void readDoorSensorSample(int& highs, int& lows, int& transitions) {
        pinMode(REED_PIN, INPUT_PULLUP);
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
        if (transitions > 10) {
          return false;
        }
        return lows >= 24 || highs >= 24;
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
        return gTestMode.length() > 0 && (long)(millis()) < (long)gTestModeUntilMs;
      }

      /** Hardware test (RTDB test_command) is only for the Components screen — never during drying. */
      static bool sessionBlocksHardwareTest() {
        return sessionStatusIsRunning() || sessionStatusIsPaused();
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

      /** DHT can glitch; keep last good reading briefly — never fake a temp (that locked heaters ON). */
      static float airCToUseForHeater(bool dhtOk, float airC) {
        if (dhtOk && !isnan(airC)) {
          gLastGoodAirC = airC;
          gLastGoodAirMs = millis();
          return airC;
        }
        if (!isnan(gLastGoodAirC) && (millis() - gLastGoodAirMs) < 180000UL) {
          return gLastGoodAirC;
        }
        return NAN;
      }

      /** Heater demand while drying (matches serviceHeatersForSession). */
      static bool intendedHeaterOnForSession(bool dhtOk, float airC) {
        if (!dryingSessionOutputsActive()) {
          return false;
        }
      #if HEATER_MIRROR_FAN
        return true;
      #endif
        if (gSessionTargetC <= 1.0f) {
          return false;
        }
        const float t = airCToUseForHeater(dhtOk, airC);
        const bool bootstrap =
            (gDryingSessionStartMs > 0) &&
            ((millis() - gDryingSessionStartMs) < HEATER_DHT_BOOTSTRAP_MS);
        const bool warmup =
            (gDryingSessionStartMs > 0) &&
            ((millis() - gDryingSessionStartMs) < SESSION_HEATER_WARMUP_MS);
        if (warmup) {
          return true;
        }
        if (isnan(t)) {
          return bootstrap;
        }
        return t < (gSessionTargetC - TEMP_TARGET_MARGIN_C);
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

      static bool tempFaultForBuzzer(bool dhtOk, float airC) {
        if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
          return false;
        }
        if (!dhtOk || isnan(airC) || gSessionTargetC <= 1.0f) {
          return false;
        }
        if (airC > (gSessionTargetC + TEMP_TARGET_MARGIN_C)) {
          return true;
        }
        if (airC < (gSessionTargetC - TEMP_TARGET_MARGIN_C)) {
          if (gDryingSessionStartMs == 0) {
            return false;
          }
          return (millis() - gDryingSessionStartMs) >= TEMP_BELOW_TARGET_AFTER_DRYING_MS;
        }
        return false;
      }

      static void applyFanSpeedForSession() {
        serviceFanSpeedRelay(millis());
      }

      /** Single relay fan: ON for entire drying session (no duty cycling — relay cannot PWM). */
      static void serviceFanSpeedRelay(unsigned long nowMs) {
        (void)nowMs;
        const bool active = dryingSessionOutputsActive();
        if (!active) {
          sFanSessionOutputsWereActive = false;
          driveFanLoad(false);
          return;
        }
        if (!sFanSessionOutputsWereActive) {
          sFanSessionOutputsWereActive = true;
          forceFanRelayWakeOn();
          return;
        }
        driveFanLoad(true);
      }

      /** Heaters: mirror fan while drying (HEATER_MIRROR_FAN) or thermostat below target. */
      static void serviceHeatersForSession(bool dhtOk, float airC) {
        if (!dryingSessionOutputsActive()) {
          driveHeaterLoad(false);
          return;
        }
      #if HEATER_MIRROR_FAN
        driveHeaterLoad(true);
        static unsigned long lastHeaterLogMs = 0;
        const unsigned long now = millis();
        if (lastHeaterLogMs == 0 || (now - lastHeaterLogMs) > 8000UL) {
          lastHeaterLogMs = now;
          Serial.print("[heater] SESSION ON authorized=");
          Serial.print(gDryRunAuthorized ? 1 : 0);
          Serial.print(" status=");
          Serial.print(gSessionStatus);
          Serial.print(" cmdOn=");
          Serial.print(sHeaterCommandedOn ? 1 : 0);
          Serial.print(" gpio19=");
          Serial.println(digitalRead(RELAY_HEATER1));
        }
        (void)dhtOk;
        (void)airC;
        return;
      #endif
        if (gSessionTargetC <= 1.0f) {
          driveHeaterLoad(false);
          return;
        }
        const float t = airCToUseForHeater(dhtOk, airC);
        const bool bootstrap =
            (gDryingSessionStartMs > 0) &&
            ((millis() - gDryingSessionStartMs) < HEATER_DHT_BOOTSTRAP_MS);
        const bool warmup =
            (gDryingSessionStartMs > 0) &&
            ((millis() - gDryingSessionStartMs) < SESSION_HEATER_WARMUP_MS);
        bool heatOn = warmup;
        if (!heatOn) {
          if (isnan(t)) {
            heatOn = bootstrap;
          } else {
            heatOn = t < (gSessionTargetC - TEMP_TARGET_MARGIN_C);
          }
        }
        driveHeaterLoad(heatOn);
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

      /** Fan + heaters OFF immediately (pause/stop/safety). */
      static void forceActuatorsOff() {
        driveFanLoad(false);
        driveHeaterLoad(false);
        static unsigned long lastLogMs = 0;
        const unsigned long now = millis();
        if (lastLogMs == 0 || (now - lastLogMs) > 5000UL) {
          lastLogMs = now;
          logLoadPinLevels("FORCE-OFF");
        }
      }

      static void beginDryingOutputs(bool chirp) {
        gDryRunAuthorized = true;
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
        logActuatorState("drying-on");
        logActualLoadGpios("drying");
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
        if (dryingSessionOutputsActive() || hardwareTestActive()) {
          return;
        }
        if (!fanLoadIsOn() && !heaterLoadIsOn(RELAY_HEATER1) && !heaterLoadIsOn(RELAY_HEATER2)) {
          return;
        }
        forceActuatorsOff();
      }

      static void updateBuzzerFaultLatch(bool dhtOk, bool moistureOk, bool doorOk, bool doorOpen, float airC) {
        static bool sLoggedFault = false;
        (void)moistureOk;
        if (!dryingSessionActiveForBuzzer() || !sessionStatusIsRunning()) {
          disengageBuzzerAlarm();
          sLoggedFault = false;
          return;
        }
        const bool sensorFault = sensorsBadForBuzzer(dhtOk, moistureOk, doorOk);
        const bool tempFault = tempFaultForBuzzer(dhtOk, airC);
        const bool doorOpenFault = doorOpenedDuringDryingFault(doorOk, doorOpen);
        const bool faultNow = sensorFault || tempFault || doorOpenFault;
        if (faultNow) {
          if (!sLoggedFault) {
            sLoggedFault = true;
            Serial.print("[buzzer] DRYING FAULT sensor=");
            Serial.print(sensorFault ? 1 : 0);
            Serial.print(" temp=");
            Serial.print(tempFault ? 1 : 0);
            Serial.print(" doorOpen=");
            Serial.print(doorOpenFault ? 1 : 0);
            Serial.print(" dht=");
            Serial.print(dhtOk ? 1 : 0);
            Serial.print(" moist=");
            Serial.print(moistureOk ? 1 : 0);
            Serial.print(" doorOk=");
            Serial.print(doorOk ? 1 : 0);
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

      /** Maximum volume: fast square wave on GPIO27 (loudest for passive piezo). */
      static void buzzerDriveLoud() {
      #if BUZZER_ACTIVE_HIGH
        pinMode(BUZZER_PIN, OUTPUT);
        digitalWrite(BUZZER_PIN, HIGH);
        gBuzzerTonePlaying = true;
        gBuzzerPinHigh = true;
      #else
        if (gBuzzerHwPwmOn) {
          ledcWrite(BUZZER_PIN, 0);
          ledcDetach(BUZZER_PIN);
          gBuzzerHwPwmOn = false;
        }
        noTone(BUZZER_PIN);
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
          buzzerForceSilent();
          return;
        }

        if (!gBuzzerAlarmEngaged) {
          if (gBuzzerTonePlaying || gBuzzerHwPwmOn) buzzerForceSilent();
          return;
        }

        applyBuzzerCycleFromClock(now);
      }

      void connectWifiBlocking(uint32_t timeoutMs = 15000) {
        if (WiFi.status() == WL_CONNECTED) return;

        WiFi.persistent(false);
        WiFi.disconnect(true, true);
        delay(100);
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);
        WiFi.begin(WIFI_SSID, WIFI_PASS);

        Serial.print("Connecting WiFi");
        uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
          delay(250);
          yield();
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

      static void appendRtdbAuthQuery(String& url) {
        if (strlen(FIREBASE_DB_SECRET) == 0) return;
        url += (url.indexOf('?') >= 0) ? "&" : "?";
        url += "auth=";
        url += FIREBASE_DB_SECRET;
      }

      static String rtdbGetText(const String& pathNoJsonSuffix) {
        serviceLocalHmiKeys();
        if (WiFi.status() != WL_CONNECTED) return String();
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.setTimeout(RTDB_GET_TIMEOUT_MS);
        http.setConnectTimeout(RTDB_GET_CONNECT_TIMEOUT_MS);
        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";
        appendRtdbAuthQuery(url);
        http.begin(client, url);
        const int code = http.GET();
        String body;
        if (code >= 200 && code < 300) {
          body = http.getString();
        } else {
          Serial.print("[RTDB] GET ");
          Serial.print(code);
          Serial.print(" ");
          Serial.println(pathNoJsonSuffix);
        }
        http.end();
        serviceLocalHmiKeys();
        return body;
      }

      /** Initialize MAC-based identity; load any persisted assignment from NVS. */
      static void initIdentity() {
        gDeviceMac = WiFi.macAddress();
        gDeviceMacSafe = gDeviceMac;
        gDeviceMacSafe.replace(":", "");
        gDeviceMacSafe.toUpperCase();
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

      /**
       * If assignments/{MAC} is missing, find machines/{id}/hardware_status whose mac matches
       * this board (same path the mobile app listens on).
       */
      static int findMachineIdForMacInMachinesJson() {
        const String body = rtdbGetText("machines");
        if (body.length() < 8 || body == "null") return 0;

        String needle = String("\"mac\":\"") + gDeviceMac + "\"";
        int macPos = body.indexOf(needle);
        if (macPos < 0) {
          needle = String("\"mac\":\"") + gDeviceMacSafe + "\"";
          macPos = body.indexOf(needle);
        }
        if (macPos < 0) return 0;

        const int sliceStart = macPos > 320 ? (macPos - 320) : 0;
        const String slice = body.substring(sliceStart, macPos);
        for (int i = (int)slice.length() - 1; i >= 1; i--) {
          if (slice[i] != '"') continue;
          const int end = i;
          int start = i - 1;
          while (start >= 0 && slice[start] != '"') start--;
          if (start < 0) continue;
          const String key = slice.substring(start + 1, end);
          if (key.length() == 0 || key.length() > 6) continue;
          bool digits = true;
          for (unsigned int k = 0; k < key.length(); k++) {
            if (!isdigit((unsigned char)key[k])) {
              digits = false;
              break;
            }
          }
          if (!digits) continue;
          int j = end + 1;
          while (j < (int)slice.length() && (slice[j] == ' ' || slice[j] == '\t')) j++;
          if (j < (int)slice.length() && slice[j] == ':') {
            const int id = key.toInt();
            if (id > 0) return id;
          }
        }
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
        if (haveAssignment) {
          const int nameKey = body.indexOf("\"name\"");
          if (nameKey >= 0) {
            int colon = body.indexOf(':', nameKey);
            int q1 = body.indexOf('"', colon + 1);
            int q2 = q1 >= 0 ? body.indexOf('"', q1 + 1) : -1;
            if (q1 >= 0 && q2 > q1) newName = body.substring(q1 + 1, q2);
          }
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

      static void enterPausedSession() {
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
        resetDoorOpenBuzzerPolicy();
        disengageBuzzerAlarm();
        initLoadPinsForcedOff();
        applyLedsForSession("paused");
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
        const int dm = parseJsonIntAfterKey(body, "set_duration_minutes", 0);
        if (dm > 0) {
          gLocalDurationMin = dm;
          gLocalDurationSec = dm * 60;
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
      }

      static void forceIdleSessionState() {
        gDryRunAuthorized = false;
        gDryingOutputsLatched = false;
        gSessionStatus = "stopped";
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
        resetDoorOpenBuzzerPolicy();
        disengageBuzzerAlarm();
        pauseLocalHardwareTestOnly();
        initLoadPinsForcedOff();
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
        if (gAssignedId > 0) {
          return gAssignedId;
        }
        return effectiveSessionMachineId();
      }

      /**
       * Mobile + Laravel write `machines/{id}/command` — ESP applies this first (reliable).
       */
      static void applyCloudCommandFromRtdb(int mid) {
        if (mid <= 0) {
          return;
        }
        const String path = String("machines/") + String(mid) + "/command";
        const String body = rtdbGetText(path);
        if (body.length() == 0 || body == "null") {
          return;
        }

        const unsigned long seq =
            (unsigned long)parseJsonFloatAfterKey(body, "seq", 0);
        if (seq > 0 && seq <= gLastCommandSeq) {
          return;
        }

        String action = parseJsonStringAfterKey(body, "action", "");
        action.toLowerCase();
        action.trim();
        if (action.length() == 0) {
          action = parseJsonStringAfterKey(body, "command", "");
          action.toLowerCase();
          action.trim();
        }

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

        if (action == "stop") {
          if (seq > 0) {
            gLastCommandSeq = seq;
          }
          Serial.println("[command] stop");
          // App already persisted via Laravel — just idle locally + LCD.
          forceIdleSessionState();
        #if ENABLE_LOCAL_HMI
          LocalHmi::adoptCloudStopped();
        #endif
          return;
        }

        if (action == "pause") {
          if (seq > 0) {
            gLastCommandSeq = seq;
          }
          Serial.println("[command] pause");
          enterPausedSession();
        #if ENABLE_LOCAL_HMI
          LocalHmi::adoptCloudPaused();
        #endif
          return;
        }

        if (action == "start") {
          if (seq > 0) {
            gLastCommandSeq = seq;
          }
          gIgnoreStaleRunningUntilMs = 0;
          // Pull fish/qty/duration from command if present (app start).
          applySessionParamsFromBody(body);
          if (sessionStatusIsPaused()) {
            gLocalRunSegmentStartMs = millis();
          } else if (!sessionStatusIsRunning()) {
            gLocalRunAccumMs = 0;
            gLocalRunSegmentStartMs = millis();
            if (gLocalDurationSec < 1 && gLocalDurationMin > 0) {
              gLocalDurationSec = gLocalDurationMin * 60;
            }
          }
          if (sessionStatusIsRunning() && gDryRunAuthorized) {
            Serial.print("[command] start (params only) fan=");
            Serial.println(gFanSpeedLevel);
            applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
          #if ENABLE_LOCAL_HMI
            LocalHmi::adoptCloudSession(gLocalFishType, gLocalTotalFish, gSessionTargetC,
                                        gLocalDurationSec > 0 ? gLocalDurationSec
                                                              : gLocalDurationMin * 60);
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
        #if ENABLE_LOCAL_HMI
          LocalHmi::adoptCloudSession(gLocalFishType, gLocalTotalFish, gSessionTargetC,
                                      gLocalDurationSec > 0 ? gLocalDurationSec
                                                            : gLocalDurationMin * 60);
        #endif
        }
      }

      static void applySessionLedsOnly() {
        applyLedsForSession(
            gSessionStatus.length() ? gSessionStatus : String("stopped"));
      }

      /**
       * Pull `machines/{gAssignedId}/session` from RTDB (status, fan_speed, target_temperature).
       * Mobile writes the whole object on Start/Pause/Stop.
       */
      static void refreshSessionFromCloud() {
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

        applyCloudCommandFromRtdb(mid);

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
          // Keep local HMI drying alive if RTDB is still stale "stopped" (offline / race).
          // Real app Stop is applied in applyCloudCommandFromRtdb (fresh seq → forceIdle).
          if (gLocalHmiOwned && (sessionStatusIsRunning() || sessionStatusIsPaused())) {
            // Heal RTDB at most every 10s — never on every poll (HTTPS freezes keypad).
            static unsigned long lastHealMs = 0;
            if (millis() - lastHealMs >= 10000UL) {
              lastHealMs = millis();
              queueHmiNetworkSync(sessionStatusIsPaused() ? "paused" : "running", nullptr);
            }
            if (sessionStatusIsRunning() && gDryRunAuthorized) {
              applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
            }
            return;
          }
          forceIdleSessionState();
          return;
        }

        if (command == "pause" || status == "paused") {
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
          gMoistureCheckArmed = false;
          applySessionParamsFromBody(body);
          if (!gDryRunAuthorized) {
            /** App Start writes session.command=start — honor that (fan/heater/buzzer). */
            if (command == "start") {
              Serial.println("[session] command=start — authorize outputs");
              if (gLocalDurationSec < 1 && gLocalDurationMin > 0) {
                gLocalDurationSec = gLocalDurationMin * 60;
              }
              if (gLocalRunSegmentStartMs == 0) {
                gLocalRunAccumMs = 0;
                gLocalRunSegmentStartMs = millis();
              }
              beginDryingOutputs(false);
              // Do not steal ownership from an active keypad session.
            } else if (millis() < gIgnoreStaleRunningUntilMs) {
              initLoadPinsForcedOff();
              return;
            } else if (gLocalHmiOwned) {
              // Local keypad session already authorized — ignore stale cloud "running".
            } else {
              Serial.println("[session] stale running without start — outputs OFF");
              forceIdleSessionState();
              return;
            }
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
                                      gLocalDurationSec > 0 ? gLocalDurationSec
                                                            : gLocalDurationMin * 60);
        #endif
          applyDryingSessionLoads(pollDhtIfDue(), cachedDhtT);
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
        gTestFanLevel = 3;
        buzzerForceSilent();
        if (!gDryingOutputsLatched) {
          loadsHardwareAllOff();
        }
        applyLedsForSession(gSessionStatus);
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

        // Keypad-only: wait until user presses all buttons (LCD stays on keypad prompt only).
        if (mode == "component" &&
            (c == "keypad" || c == "keypad_4x4" || c == "key_pad")) {
          LocalHmi::startKeypadSelfTest(0);
          return;
        }

        // LCD-only: "LCD IS WORKING!" — no keypad phase.
        if (mode == "component" &&
            (c == "lcd" || c == "lcd_16x2" || c == "display")) {
          LocalHmi::startLcdSelfTest(2500UL);
          return;
        }

        // Test All only: LCD flash then keypad. Individual sensor tests = no HMI takeover.
        if (mode == "all") {
          LocalHmi::startCombinedUiSelfTest(0);
        }
      #else
        (void)mode;
        (void)component;
        (void)durationMs;
      #endif
      }

      static void tickHardwareTestOutputs() {
        const unsigned long now = millis();
        if (sessionBlocksHardwareTest()) {
          pauseLocalHardwareTestOnly();
      #if ENABLE_LOCAL_HMI
          LocalHmi::endUiSelfTest();
      #endif
          return;
        }

      #if ENABLE_LOCAL_HMI
        // Keep remote test alive while user is still finishing the keypad.
        if (LocalHmi::keypadSelfTestWaiting() || LocalHmi::uiSelfTestActive()) {
          if (gTestMode.length() > 0) {
            gTestModeUntilMs = millis() + 60000UL;  // extend — no artificial cut-off
          }
          LocalHmi::pollKeypadFast();
          // Do NOT repaint LCD every tick — I2C steals time from key scanning.
        }
      #endif

        if (!hardwareTestActive()) {
          if (gTestMode.length() > 0) endHardwareTest();
          return;
        }

        if (gTestMode == "all") {
          applyLedsForSession(gSessionStatus);
          // Don't blast fan/heater/buzzer while user is pressing keypad — keep UI responsive.
        #if ENABLE_LOCAL_HMI
          if (LocalHmi::keypadSelfTestWaiting() ||
              (LocalHmi::uiSelfTestActive() && LocalHmi::keypadSelfTestCount() > 0)) {
            loadsHardwareAllOff();
            buzzerForceSilent();
            return;
          }
        #endif
          driveFanLoad(true);
          driveHeaterLoad(true);
          buzzerTestDrive();
          return;
        }

        if (gTestMode == "component") {
          String c = gTestComponent;
          c.toLowerCase();
          if (c == "fan" || c == "fan_1" || c == "fan_2" || c == "fan_3") {
            loadsHardwareAllOff();
            driveFanLoad(true);
            applyLedsForSession(gSessionStatus);
            return;
          }
          if (c == "heater" || c == "heater_1" || c == "heater_2") {
            loadsHardwareAllOff();
            driveHeaterLoad(true);
            applyLedsForSession(gSessionStatus);
            return;
          }
          if (c == "buzzer" || c == "piezo" || c == "piezo_buzzer") {
            loadsHardwareAllOff();
            buzzerTestDrive();
            applyLedsForSession(gSessionStatus);
            return;
          }
          if (c == "lcd" || c == "lcd_16x2" || c == "display" ||
              c == "keypad" || c == "keypad_4x4" || c == "key_pad" ||
              c == "esp32" || c == "dht22" || c == "moisture_sensor" || c == "door_sensor") {
            // Sensors / LCD / keypad UI tests — no load actuation (keeps keypad scanning free).
            loadsHardwareAllOff();
            buzzerForceSilent();
            applyLedsForSession(gSessionStatus);
            return;
          }
          const bool testsLed =
            (c == "led_1" || c == "led_2" || c == "led_3" ||
             c == "led_drying" || c == "led_pause" || c == "led_stop");

          if (testsLed) {
            const bool blink = ((now / 350UL) % 2UL) == 0UL;
            driveLed(LED_GREEN,  false);
            driveLed(LED_YELLOW, false);
            driveLed(LED_RED,    false);
            if (c == "led_1" || c == "led_drying") {
              driveLed(LED_GREEN, blink);
            } else if (c == "led_2" || c == "led_pause") {
              driveLed(LED_YELLOW, blink);
            } else if (c == "led_3" || c == "led_stop") {
              driveLed(LED_RED, blink);
            } else {
              driveLed(LED_GREEN, blink);
            }
          } else {
            applyLedsForSession(gSessionStatus);
          }

          loadsHardwareAllOff();
        }
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
        if (sessionBlocksHardwareTest()) {
          pauseLocalHardwareTestOnly();
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
        beginUiSelfTestForCommand(mode, component, durationMs);
        if (gAssignedId > 0 && reqId.length() > 0) {
          String ack = "{\"request_id\":\"";
          ack += reqId;
          ack += "\",\"status\":\"running\",\"component\":\"";
          ack += component;
          ack += "\"}";
          (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_ack", ack);
        }
      }

      static bool rtdbPutJson(const String& pathNoJsonSuffix, const String& jsonBody) {
        serviceLocalHmiKeys();
        if (WiFi.status() != WL_CONNECTED) return false;
        HTTPClient http;
        http.setTimeout(RTDB_PUT_TIMEOUT_MS);
        http.setConnectTimeout(RTDB_PUT_CONNECT_TIMEOUT_MS);

        // Firebase RTDB requires HTTPS. For quick test-mode validation, we skip cert validation.
        // (Do NOT ship like this; use certificate pinning or a proper client.)
        WiFiClientSecure client;
        client.setInsecure();

        String url = String(FIREBASE_DATABASE_URL);
        if (!url.endsWith("/")) url += "/";
        url += pathNoJsonSuffix;
        if (!url.endsWith(".json")) url += ".json";
        appendRtdbAuthQuery(url);

        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");
        int code = http.PUT(jsonBody);
        String resp = http.getString();
        http.end();
        serviceLocalHmiKeys();

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
          http.setTimeout(4000);
          http.setConnectTimeout(3000);
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

      void sendHeartbeat(bool /*dhtOk*/, bool /*moistureOk*/, bool /*doorOk*/) {
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
        bool moistureOkReport = false;
        readMoistureAdc(moistureRaw, spread, moistureMin, moistureMax);
        moistureOkReport =
            moistureSensorReportOk(moistureRaw, spread, moistureMin, moistureMax);
        if (moistureOkReport && sessionStatusIsRunning()) {
          updateMoistureBounds(moistureRaw);
        }
        const int moisturePct =
            moistureOkReport ? moisturePercentFromAdc(moistureRaw) : -1;

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
        Serial.print(" gpio35=");
        Serial.print(analogRead(PIN_MOISTURE));
        Serial.print(" pct=");
        Serial.print(moistureOkReport ? moisturePct : -1);
        if (moistureOkReport && moisturePct <= 5 && moistureRaw > 3000) {
          Serial.print(" (dip water but ADC still high — swap MOISTURE_YL69_DRY/WET in .ino)");
        }
        Serial.print(" status=");
        Serial.print(moistureOkReport ? "OK" : "FAIL(disconnected)");
        Serial.print(" | DHT ");
        Serial.print(dhtOkReport ? "OK" : "FAIL");
        Serial.print(" | DOOR ");
        #if HAVE_DOOR_SENSOR
        Serial.print("H=");
        Serial.print(doorHighs);
        Serial.print(" L=");
        Serial.print(doorLows);
        Serial.print(" T=");
        Serial.print(doorTransitions);
        Serial.print(" ");
        Serial.print(doorOkReport ? "OK" : "FAIL");
        if (gLastDoorCapLowSamples >= 0) {
          Serial.print(" riseUs~");
          Serial.print(gLastDoorCapLowSamples * 10);
        }
        Serial.print(doorOpen ? " open" : " closed");
        #else
        Serial.print("off(not installed)");
        #endif
        Serial.print(" | ESP32 ");
        Serial.print(esp32Ok ? "OK" : "FAIL");
        Serial.print(" heap=");
        Serial.println((unsigned int)ESP.getFreeHeap());

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
        payload += "\"moisture_sensor\":\""; payload += moistureStatusWord(moistureOkReport); payload += "\",";
        payload += "\"door_sensor\":\""; payload += statusWord(doorOkReport); payload += "\",";
        payload += "\"lcd\":\""; payload += statusWord(LocalHmi::lcdWorking()); payload += "\",";
        payload += "\"keypad\":\""; payload += statusWord(LocalHmi::keypadWorking()); payload += "\"";

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
            laravelReadingsComma();
            payload += "\"moisture_dry_adc\":";
            payload += MOISTURE_DRY_ADC;
            laravelReadingsComma();
            payload += "\"moisture_wet_adc\":";
            payload += MOISTURE_WET_ADC;
            laravelReadingsComma();
            payload += "\"moisture_span\":";
            payload += moistureSpanLearned;
            laravelReadingsComma();
            payload += "\"moisture_calibrated\":";
            payload += moistureCalibrated ? "true" : "false";
          }
        }
        payload += "}";
        payload += "}";

        // Push snapshot to Firebase RTDB first — mobile + Laravel read this path.
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
        root += "\"moisture_sensor\":\""; root += moistureStatusWord(moistureOkReport); root += "\",";
        root += "\"dht22\":\""; root += statusWord(dhtOkReport); root += "\",";
        root += "\"lcd\":\""; root += statusWord(LocalHmi::lcdWorking()); root += "\",";
        root += "\"keypad\":\""; root += statusWord(LocalHmi::keypadWorking()); root += "\"";
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
            readingsComma();
            root += "\"moisture_dry_adc\":";
            root += MOISTURE_DRY_ADC;
            readingsComma();
            root += "\"moisture_wet_adc\":";
            root += MOISTURE_WET_ADC;
            readingsComma();
            root += "\"moisture_span\":";
            root += moistureSpanLearned;
            readingsComma();
            root += "\"moisture_calibrated\":";
            root += moistureCalibrated ? "true" : "false";
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

        // Only publish to machines/{id}/... once an ID has been assigned by the user
        // from the mobile app. Otherwise the board just advertises in discovery/.
        const int publishId = gAssignedId > 0 ? gAssignedId : effectiveSessionMachineId();
        if (publishId > 0) {
          if (gAssignedId <= 0) {
            gAssignedId = publishId;
            persistAssignment(gAssignedId, gDeviceName);
          }
          const bool rtdbOk =
              rtdbPutJson(String("machines/") + String(publishId) + "/hardware_status", root);
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
          adv += ",\"moisture_connected\":"; adv += moistureOkReport ? "true" : "false";
          if (moistureOkReport && moisturePct >= 0) {
            adv += ",\"moisture_raw\":"; adv += moistureRaw;
            adv += ",\"moisture_percent\":"; adv += moisturePct;
          }
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

        driveFanLoad(true);
        driveHeaterLoad(true);

        buzzerHwStart();
        delay(120);
        buzzerForceSilent();
      }
      #endif

      static int gMoistureAvgCached = 0;
      static int gMoistureSpreadCached = 0;
      static int gMoistureMinCached = 4095;
      static int gMoistureMaxCached = 0;
      static unsigned long gLastMoistureSampleMs = 0;
      static unsigned long gLastAssignmentPollMs = 0;

      static void readSensorsOnce(bool& dhtOk, bool& moistureOk, bool& doorOk, bool& doorOpen) {
        dhtOk = pollDhtIfDue();

        if (millis() - gLastMoistureSampleMs >= 250UL) {
          gLastMoistureSampleMs = millis();
          int minV = 0;
          int maxV = 0;
          readMoistureAdc(gMoistureAvgCached, gMoistureSpreadCached, minV, maxV);
          gMoistureMinCached = minV;
          gMoistureMaxCached = maxV;
        }
        moistureOk = moistureSensorReportOk(
            gMoistureAvgCached, gMoistureSpreadCached, gMoistureMinCached, gMoistureMaxCached);

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

        pinMode(REED_PIN, INPUT_PULLUP);

        pinMode(PIN_MOISTURE, INPUT);
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

        gBootMs = millis();
        gIgnoreStaleRunningUntilMs = gBootMs + 12000UL;
        initLoadPinsForcedOff();

      #if defined(ESP32)
        esp_task_wdt_deinit();
      #endif

        Serial.println();
        Serial.println("##############################################");
        Serial.println("# Fish Dryer ESP32 — runtime-assigned identity");
        Serial.print("# BUILD: ");
        Serial.println(FIRMWARE_BUILD_TAG);
        Serial.println("# PINS: DHT22=4 MOISTURE=35 DOOR=16 FAN=22 H1=19 BUZZER=27");
        Serial.println("#       LED green=32 yellow=33 red=13  (H2 aliased to H1 when HMI on)");
      #if ENABLE_LOCAL_HMI
        Serial.println("# HMI FIRST — local LCD/keypad before WiFi");
        Serial.println("# HMI KEYPAD L->R labels 8..1: GPIO 12,18,5,26,25,17,15,14");
        Serial.println("# HMI mode/Stop col on GPIO12 ONLY (was GPIO2)");
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
        Serial.println("[boot] hardware OK");

        delay(200);

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
        sendHeartbeat(dhtOk, moistureOk, doorOk);
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

      /** Drain keypad several times — never block the UI behind HTTPS. */
      static void serviceLocalHmiKeys() {
      #if ENABLE_LOCAL_HMI
        for (int i = 0; i < 5; i++) {
          LocalHmi::poll();
        }
      #endif
      }

      // Deferred cloud sync so Enter/Pause/Stop update LCD instantly.
      static String gDeferredRtdbStatus;
      static String gDeferredApiAction;

      static void queueHmiNetworkSync(const char* rtdbStatus, const char* apiAction) {
        if (rtdbStatus && rtdbStatus[0]) {
          gDeferredRtdbStatus = rtdbStatus;
        }
        if (apiAction && apiAction[0]) {
          gDeferredApiAction = apiAction;
        }
      }

      static void flushHmiNetworkSync() {
      #if ENABLE_LOCAL_HMI
        // Never push cloud while user is typing / on STOP|PAUSE prompt.
        if (LocalHmi::wantsNetworkQuiet()) return;
      #endif
        if (gDeferredRtdbStatus.length()) {
          const String st = gDeferredRtdbStatus;
          gDeferredRtdbStatus = "";
          publishLocalSessionToRtdb(st.c_str());
          serviceLocalHmiKeys();
        }
        if (gDeferredApiAction.length()) {
          const String act = gDeferredApiAction;
          gDeferredApiAction = "";
          (void)postLocalSessionAction(act.c_str());
          serviceLocalHmiKeys();
        }
      }

      static void publishLocalSessionToRtdb(const char* statusWordIn) {
        const int mid = sessionMachineId();
        if (mid <= 0) return;
        if (WiFi.status() != WL_CONNECTED) return;

        String st = statusWordIn ? String(statusWordIn) : String("stopped");
        st.toLowerCase();
        st.trim();
        const bool running = (st == "running");
        const bool paused = (st == "paused");
        const char* cmd = running ? "start" : (paused ? "pause" : "stop");

        String fish = gLocalFishType;
        fish.replace("\\", "\\\\");
        fish.replace("\"", "\\\"");

        const unsigned long seq = millis();

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
        sessionJson += ",\"source\":\"local_hmi\"";
        sessionJson += ",\"updated_at\":\"";
        sessionJson += String(seq);
        sessionJson += "\"}";

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
        cmdJson += ",\"seq\":";
        cmdJson += seq;
        cmdJson += ",\"updated_at\":\"";
        cmdJson += String(seq);
        cmdJson += "\"}";

        (void)rtdbPutJson(String("machines/") + String(mid) + "/command", cmdJson);
        (void)rtdbPutJson(String("machines/") + String(mid) + "/session", sessionJson);
        // Don't re-apply our own command on next poll.
        if (seq > gLastCommandSeq) {
          gLastCommandSeq = seq;
        }
        Serial.printf("[hmi] RTDB session %s published mid=%d\n", st.c_str(), mid);
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
        if (!isnan(cachedDhtT)) {
          payload += ",\"temperature\":";
          payload += String(cachedDhtT, 1);
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
        http.setTimeout(5000);
        http.setConnectTimeout(3000);
        if (!http.begin(client, API_SESSION_URL)) {
          Serial.println("[hmi] history http.begin failed");
          return false;
        }
        http.addHeader("Content-Type", "application/json");
        Serial.print("[hmi] SAVE SESSION ");
        Serial.println(payload);
        const int code = http.POST(payload);
        const String resp = http.getString();
        http.end();
        Serial.print("[hmi] session HTTP ");
        Serial.print(code);
        Serial.print(" ");
        Serial.println(resp);
        return code >= 200 && code < 300;
      }

      static void queueLocalHistoryPayload(const String& payload) {
        gPrefs.begin("fdhmi", false);
        gPrefs.putString("hist", payload);
        gPrefs.end();
        Serial.println("[hmi] history queued in NVS (no internet)");
      }

      static void flushQueuedLocalHistory() {
        gPrefs.begin("fdhmi", false);
        const String pending = gPrefs.getString("hist", "");
        gPrefs.end();
        if (!pending.length()) return;
        if (WiFi.status() != WL_CONNECTED) return;
        if (!postHistoryPayload(pending)) return;
        gPrefs.begin("fdhmi", false);
        gPrefs.remove("hist");
        gPrefs.end();
        Serial.println("[hmi] queued history uploaded");
      }

      static bool postLocalSessionAction(const char* action) {
        const String payload = buildLocalSessionPayload(action);
        if (postHistoryPayload(payload)) return true;
        // Only queue stop/finish for later history sync — start/pause are live.
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
        gLocalRunAccumMs = 0;
        gLocalRunSegmentStartMs = millis();
        gIgnoreStaleRunningUntilMs = 0;
        // LCD/relays first — cloud sync is deferred so Enter feels instant.
        beginDryingOutputs(true);
        queueHmiNetworkSync("running", "start");
        Serial.printf("[hmi] LOCAL start duration=%ds (sync deferred)\n", gLocalDurationSec);
      }

      void hmiOnPauseDrying() {
        if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
          gLocalRunAccumMs += (millis() - gLocalRunSegmentStartMs);
          gLocalRunSegmentStartMs = 0;
        }
        enterPausedSession();
        queueHmiNetworkSync("paused", "pause");
        Serial.println("[hmi] LOCAL pause (sync deferred)");
      }

      void hmiOnResumeDrying() {
        gLocalRunSegmentStartMs = millis();
        beginDryingOutputs(true);
        gLocalHmiOwned = true;
        queueHmiNetworkSync("running", "start");
        Serial.println("[hmi] LOCAL resume (sync deferred)");
      }

      void hmiOnStopDrying() {
        if (sessionStatusIsRunning() && gLocalRunSegmentStartMs > 0) {
          gLocalRunAccumMs += (millis() - gLocalRunSegmentStartMs);
          gLocalRunSegmentStartMs = 0;
        }
        const bool hadLocal = gLocalHmiOwned || sessionStatusIsRunning() || sessionStatusIsPaused() ||
                              gLocalFishType.length() > 0;
        const unsigned long elapsedSec = localHmiElapsedSeconds();
        const String fish = gLocalFishType;
        const int total = gLocalTotalFish;
        const int dur = gLocalDurationMin;
        const int durSec = gLocalDurationSec;
        const float target = gSessionTargetC;
        const int fan = gFanSpeedLevel;
        // Idle + LCD first. Queue NVS history immediately (fast), HTTPS later.
        forceIdleSessionState();
        queueHmiNetworkSync("stopped", nullptr);
        if (hadLocal) {
          gLocalFishType = fish;
          gLocalTotalFish = total;
          gLocalDurationMin = dur;
          gLocalDurationSec = durSec;
          gSessionTargetC = target;
          gFanSpeedLevel = fan;
          gLocalRunAccumMs = elapsedSec * 1000UL;
          // NVS now (instant). flushQueuedLocalHistory() uploads when network is free.
          queueLocalHistoryPayload(buildLocalHistoryPayload());
          gLocalRunAccumMs = 0;
          gLocalFishType = "";
          gLocalTotalFish = 0;
        }
        Serial.println("[hmi] stop — UI instant; history queued");
      }

      void hmiOnDurationComplete() {
        Serial.println("[hmi] duration complete — stop + save");
        hmiOnStopDrying();
      }

      bool hmiSessionIsRunning() { return sessionStatusIsRunning(); }
      bool hmiSessionIsPaused() { return sessionStatusIsPaused(); }
      float hmiLiveTemperatureC() { return cachedDhtT; }

      bool hmiDoorIsOpen() {
        bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);
        return doorOk && doorOpen;
      }

      bool hmiLocalDurationExpired() {
        if (!sessionStatusIsRunning()) return false;
        if (gLocalDurationSec < 1) return false;
        return localHmiElapsedSeconds() >= (unsigned long)gLocalDurationSec;
      }

      long hmiRemainingDurationSec() {
        if (gLocalDurationSec < 1) {
          // Fall back to set duration digits on LCD if cloud didn't send minutes yet.
          return 0;
        }
        long rem = (long)gLocalDurationSec - (long)localHmiElapsedSeconds();
        if (rem < 0) rem = 0;
        return rem;
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
        // Always service keypad first — HTTPS must never starve Enter/Pause/Stop.
        serviceLocalHmiKeys();

        // ============================================================
        // KEYPAD SELF-TEST: stay in a tight keypad-only loop.
        // Normal HMI keypad works via Keypad.getKey(); WiFi/HTTPS was
        // starving that path during tests. Do NOT touch relays/network
        // here except a rare cancel/progress check.
        // ============================================================
        if (LocalHmi::keypadSelfTestWaiting()) {
          Serial.println("[test] KEYPAD MODE — mash all buttons (network paused)");
          uint8_t lastCount = 255;
          while (LocalHmi::serviceKeypadSelfTestSlice()) {
            const uint8_t count = LocalHmi::keypadSelfTestCount();
            if (count != lastCount) {
              lastCount = count;
              Serial.printf("[test] keypad keys %u/16\n", (unsigned)count);
            }
            if (count >= 16) {
              Serial.println("[test] keypad COMPLETE");
              // One progress write after complete — never during mashing.
              if (gAssignedId > 0 && gLastTestRequestId.length() > 0) {
                String ack = "{\"request_id\":\"";
                ack += gLastTestRequestId;
                ack += "\",\"status\":\"running\",\"component\":\"keypad\",\"keys_pressed\":16,\"keys_total\":16,\"ok\":true}";
                (void)rtdbPutJson(String("machines/") + String(gAssignedId) + "/test_ack", ack);
              }
              break;
            }
            // Keep the command alive locally, but do not touch HTTPS while the user is
            // pressing keys; those blocking calls were causing missed counts.
            if (gTestMode.length() > 0) {
              gTestModeUntilMs = millis() + 60000UL;
            }
            delay(1);
          }
          Serial.println("[test] left KEYPAD MODE");
          // Fall through to normal loop once for cleanup/heartbeat.
        }

        const bool quiet =
            LocalHmi::wantsNetworkQuiet() &&
            !hardwareTestActive() &&
            !LocalHmi::uiSelfTestActive();
        if (!quiet) {
          flushQueuedLocalHistory();
          flushHmiNetworkSync();
        }

        if (quiet) {
          bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
          readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);
          applySessionLedsOnly();
          commitLoadRelays(dhtOk, cachedDhtT);
          serviceBuzzer(dhtOk, moistureOk, doorOk, doorOpen, cachedDhtT);
          safetyCutLoadsUnlessRunning();
          serviceLocalHmiKeys();
          delay(2);
          return;
        }
      #endif

        if (WiFi.status() != WL_CONNECTED) {
          connectWifiBlocking(3000);
          serviceLocalHmiKeys();
        }
      #if ENABLE_LOCAL_HMI
        serviceLocalHmiKeys();
      #endif

        bool dhtOk = false, moistureOk = false, doorOk = false, doorOpen = false;
        readSensorsOnce(dhtOk, moistureOk, doorOk, doorOpen);

        const unsigned long assignmentPollMs =
            gAssignedId > 0 ? ASSIGNMENT_POLL_ASSIGNED_MS : ASSIGNMENT_POLL_UNASSIGNED_MS;
        if (millis() - gLastAssignmentPollMs >= assignmentPollMs) {
          gLastAssignmentPollMs = millis();
          if (refreshAssignmentFromCloud()) {
            Serial.print("[assignment] active id=");
            Serial.println(gAssignedId);
          } else if (gAssignedId <= 0) {
            static unsigned long lastWarn = 0;
            const unsigned long now = millis();
            if (lastWarn == 0 || (now - lastWarn) > 15000UL) {
              lastWarn = now;
              Serial.println(
                  "[assignment] ID=0 — Save board in app OR ensure machines/{id} has this MAC");
            }
          }
          serviceLocalHmiKeys();
        }
      #if ENABLE_LOCAL_HMI
        serviceLocalHmiKeys();
      #endif
        if (millis() - gLastSessionPollMs >= SESSION_POLL_MS) {
          gLastSessionPollMs = millis();
          refreshSessionFromCloud();
          serviceLocalHmiKeys();
        }
      #if ENABLE_LOCAL_HMI
        serviceLocalHmiKeys();
        flushHmiNetworkSync();
      #endif
      #if ENABLE_RTDB_HARDWARE_TEST
        if (!gDryingOutputsLatched && !sessionStatusIsRunning() && !sessionStatusIsPaused()) {
          if (millis() - gLastTestCmdPollMs >= TEST_COMMAND_POLL_MS) {
            gLastTestCmdPollMs = millis();
            refreshTestCommandFromCloud();
            serviceLocalHmiKeys();
          }
        }
      #endif
        applySessionLedsOnly();
        commitLoadRelays(dhtOk, cachedDhtT);
      #if ENABLE_RTDB_HARDWARE_TEST
        if (!gDryingOutputsLatched) {
          tickHardwareTestOutputs();
        }
      #endif
        serviceBuzzer(dhtOk, moistureOk, doorOk, doorOpen, cachedDhtT);
        safetyCutLoadsUnlessRunning();

        if (millis() - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
          sendHeartbeat(dhtOk, moistureOk, doorOk);
      #if ENABLE_RTDB_HARDWARE_TEST
          if (!gDryingOutputsLatched) {
            tickHardwareTestOutputs();
          }
      #endif
          commitLoadRelays(dhtOk, cachedDhtT);
          lastHeartbeatMs = millis();
          serviceLocalHmiKeys();
        }
      #if ENABLE_LOCAL_HMI
        serviceLocalHmiKeys();
      #endif
        delay(2);
      }
