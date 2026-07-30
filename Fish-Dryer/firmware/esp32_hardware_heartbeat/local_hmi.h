/**
 * Local HMI — face layout:
 *
 * NUMBER:   1      2      3     mode
 *           4      5      6      <-
 *           7      8      9      ->
 *           0     Del  Enter  Stop
 *
 * ALPHABET: ABC   DEF   GHI    mode
 *           JKL   MNO   PQR    <-
 *           STU   VWX   YZ     ->
 *           spc   Del  Enter  Stop
 *
 * Raw codes from YOUR working pad (do not scramble KEY_MAP again):
 *   A=mode B=<- C=-> D=Stop *=0/spc
 *   '0' button face = Del   |   '#' button face = Enter
 * Mode col: GPIO12. LCD: SDA=21 SCL=23
 */

#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Keypad.h>
#include <string.h>

#ifndef ENABLE_LOCAL_HMI
#define ENABLE_LOCAL_HMI 1
#endif

#if ENABLE_LOCAL_HMI

#ifndef PIN_LCD_SDA
#define PIN_LCD_SDA 21
#endif
#ifndef PIN_LCD_SCL
#define PIN_LCD_SCL 23
#endif
#ifndef LCD_I2C_ADDR
#define LCD_I2C_ADDR 0x27
#endif
#ifndef HMI_MULTITAP_MS
#define HMI_MULTITAP_MS 1500UL
#endif
#ifndef HMI_PARAM_ROTATE_MS
#define HMI_PARAM_ROTATE_MS 5000UL
#endif
#ifndef HMI_DOOR_COUNTDOWN_S
#define HMI_DOOR_COUNTDOWN_S 5
#endif

void hmiOnStartDrying(const String& fishType, int totalFish, float targetC,
                      int durationSec, int fanSpeed);
void hmiOnStopDrying();
void hmiOnPauseDrying();
void hmiOnResumeDrying();
void hmiOnDurationComplete();
bool hmiSessionIsRunning();
bool hmiSessionIsPaused();
float hmiLiveTemperatureC();
bool hmiDoorIsOpen();
bool hmiLocalDurationExpired();
long hmiRemainingDurationSec();

namespace LocalHmi {

class EspLcdI2c {
 public:
  uint8_t addr = LCD_I2C_ADDR;
  uint8_t bl = 0x08;
  bool ok = false;
  bool begin(uint8_t a) {
    addr = a;
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) return false;
    delay(50);
    write4(0x03); delay(5);
    write4(0x03); delay(5);
    write4(0x03); delay(1);
    write4(0x02);
    cmd(0x28); cmd(0x0C); cmd(0x06);
    clear();
    ok = true;
    return true;
  }
  void clear() { cmd(0x01); delay(2); }
  void setCursor(uint8_t c, uint8_t r) {
    static const uint8_t off[] = {0x00, 0x40};
    cmd(0x80 | (off[r > 1 ? 1 : r] + c));
  }
  void printPad16(const char* s) {
    char b[17];
    snprintf(b, sizeof(b), "%-16.16s", s);
    for (int i = 0; b[i]; i++) data((uint8_t)b[i]);
  }
 private:
  void exp(uint8_t v) {
    Wire.beginTransmission(addr);
    Wire.write(v | bl);
    Wire.endTransmission();
  }
  void pulse(uint8_t d) {
    exp(d | 0x04);
    delayMicroseconds(1);
    exp(d & ~0x04);
    delayMicroseconds(50);
  }
  void write4(uint8_t v) { pulse((v & 0x0F) << 4); }
  void send(uint8_t v, uint8_t mode) {
    pulse((v & 0xF0) | mode);
    pulse(((v << 4) & 0xF0) | mode);
  }
  void cmd(uint8_t v) { send(v, 0); }
  void data(uint8_t v) { send(v, 1); }
};

enum class Screen : uint8_t {
  Start,
  EditParams,
  ConfirmStart,
  DoorWarn,
  ContinueDoor,
  Running,
  StopOrPause,  // STOP left / PAUSE right — Enter=Pause, Stop=Stop+save
  Message,
  LcdSelfTest,
  KeypadSelfTest,
};

/** 16 unique face keys on the 4x4 pad (raw codes). */
static const char KEYPAD_TEST_KEYS[16] = {
    '1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'};

enum class InputMode : uint8_t { Numeric, Alphabet };

static const uint8_t PARAM_COUNT = 4;
static const char* PARAM_LABELS[PARAM_COUNT] = {
    "Fish Name:", "Qty:", "Temp:", "Duration:",
};

static EspLcdI2c lcd;

static const byte ROWS = 4;
static const byte COLS = 4;
// EXACT map from when keypad worked ("GOOD"). Do not reshuffle cells.
// Face bottom: 0 | Del | Enter | Stop  →  raw * | 0 | # | D
static char keys[ROWS][COLS] = {
    {'D', 'B', 'C', 'A'},
    {'#', '6', '9', '3'},
    {'0', '5', '8', '2'},
    {'*', '4', '7', '1'},
};
static byte rowPins[ROWS] = {14, 15, 17, 25};
static byte colPins[COLS] = {26, 5, 18, 12};
static Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

static bool gReady = false;
static bool gLcdOk = false;
static bool gKeypadOk = false;
static Screen gScreen = Screen::Start;
static InputMode gMode = InputMode::Alphabet;
static uint8_t gParamIdx = 0;
static String gParams[PARAM_COUNT];
static unsigned long gMessageUntilMs = 0;
static Screen gMessageReturn = Screen::Start;

static char gTapKey = 0;
static uint8_t gTapPos = 0;
static unsigned long gTapMs = 0;
static unsigned long gLastKeypressMs = 0;

static uint8_t gDoorCountLeft = HMI_DOOR_COUNTDOWN_S;
static unsigned long gDoorTickMs = 0;
static uint8_t gRunPage = 0;  // 0 = FISH+Qty, 1 = Temp+Time
static unsigned long gRunPageMs = 0;
static unsigned long gRunTickMs = 0;  // 1 Hz countdown refresh on Temp/Left page

/** Hardware Status → Test LCD / Test All */
static unsigned long gLcdTestUntilMs = 0;
static uint8_t gLcdTestCountLeft = 0;
static unsigned long gLcdTestTickMs = 0;
static Screen gLcdTestReturn = Screen::Start;

/** Hardware Status → Test Keypad / Test All */
static unsigned long gKeypadTestUntilMs = 0;
static uint16_t gKeypadTestMask = 0;
static uint8_t gKeypadTestLastCount = 0;
static Screen gKeypadTestReturn = Screen::Start;
static bool gKeypadTestNoTimeout = false;  // wait until all 16 keys
static bool gUiSelfTestActive = false;

static const char* ALPHA_MAP[10] = {
    " ", "ABC", "DEF", "GHI", "JKL", "MNO", "PQR", "STU", "VWX", "YZ",
};

/** Duration digits (max 6) → always "HH:MM:SS" (right-filled, empty = 00:00:00). */
static void formatDurationHms(const String& digits, char* out, size_t outSz) {
  char d[7] = {'0', '0', '0', '0', '0', '0', 0};
  int n = (int)digits.length();
  if (n > 6) n = 6;
  for (int i = 0; i < n; i++) {
    char c = digits.charAt(digits.length() - n + i);
    if (c >= '0' && c <= '9') d[6 - n + i] = c;
  }
  snprintf(out, outSz, "%c%c:%c%c:%c%c", d[0], d[1], d[2], d[3], d[4], d[5]);
}

static long durationDigitsToSeconds(const String& digits) {
  char hms[9];
  formatDurationHms(digits, hms, sizeof(hms));
  int hh = (hms[0] - '0') * 10 + (hms[1] - '0');
  int mm = (hms[3] - '0') * 10 + (hms[4] - '0');
  int ss = (hms[6] - '0') * 10 + (hms[7] - '0');
  return (long)hh * 3600L + (long)mm * 60L + (long)ss;
}

static void lcdLine(uint8_t row, const char* text) {
  if (!gLcdOk) return;
  lcd.setCursor(0, row);
  lcd.printPad16(text);
}

static void lcdCentered(uint8_t row, const char* text) {
  char line[17];
  memset(line, ' ', 16);
  line[16] = 0;
  int n = (int)strlen(text);
  if (n > 16) n = 16;
  int pad = (16 - n) / 2;
  memcpy(line + pad, text, (size_t)n);
  lcdLine(row, line);
}

static void showMessage(const char* a, const char* b, unsigned long ms, Screen ret) {
  gMessageUntilMs = millis() + ms;
  gMessageReturn = ret;
  gScreen = Screen::Message;
  if (!gLcdOk) return;
  lcd.clear();
  lcdLine(0, a);
  lcdLine(1, b);
}

// Forward declarations for helpers referenced before their definitions.
static void clearTap();
static void handlePauseYes();

static void syncModeForParam() {
  if (gParamIdx != 0) gMode = InputMode::Numeric;
}

static char modeIndicator() {
  if (gParamIdx != 0) return 'N';
  return (gMode == InputMode::Alphabet) ? 'A' : 'N';
}

static void resetParams() {
  gParamIdx = 0;
  gMode = InputMode::Alphabet;
  for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i] = "";
}

static void renderStart() {
  if (!gLcdOk) return;
  lcdCentered(0, "START DRYING");
  lcdCentered(1, "SESSION!");
}

static void renderEdit() {
  if (!gLcdOk) return;
  syncModeForParam();
  char top[17];
  snprintf(top, sizeof(top), "%-15.15s", PARAM_LABELS[gParamIdx]);
  top[15] = modeIndicator();
  top[16] = 0;
  lcdLine(0, top);
  String val = gParams[gParamIdx];
  if (gParamIdx == 3) {
    // Duration always shown as 00:00:00
    char hms[9];
    formatDurationHms(val, hms, sizeof(hms));
    lcdLine(1, hms);
  } else if (gParamIdx == 2) {
    char line[17];
    if (val.length() > 15) val = val.substring(val.length() - 15);
    snprintf(line, sizeof(line), "%sC", val.c_str());
    lcdLine(1, line);
  } else {
    if (val.length() > 16) val = val.substring(val.length() - 16);
    lcdLine(1, val.c_str());
  }
}

static void renderConfirmStart() {
  if (!gLcdOk) return;
  lcdCentered(0, "START NOW?");
  // Exact layout you asked for:
  lcdLine(1, "YES(E)      NO(S)");
}

static void renderDoorWarn() {
  if (!gLcdOk) return;
  // "DOOR IS OPEN!" on 2 lines + countdown
  lcdCentered(0, "DOOR IS");
  char buf[17];
  snprintf(buf, sizeof(buf), "OPEN! %u", (unsigned)gDoorCountLeft);
  lcdCentered(1, buf);
}

static void renderContinueDoor() {
  if (!gLcdOk) return;
  lcdCentered(0, "CONTINUE?");
  lcdLine(1, "YES(E)      NO(S)");
}

static void formatRemainingHms(long remSec, char* out, size_t outSz) {
  if (remSec < 0) remSec = 0;
  long hh = remSec / 3600L;
  long mm = (remSec % 3600L) / 60L;
  long ss = remSec % 60L;
  if (hh > 99) hh = 99;
  snprintf(out, outSz, "%02ld:%02ld:%02ld", hh, mm, ss);
}

static void renderRunning() {
  if (!gLcdOk) return;
  char a[17], b[17];
  if (gRunPage == 0) {
    snprintf(a, sizeof(a), "FISH:%.11s", gParams[0].c_str());
    snprintf(b, sizeof(b), "Qty:%s", gParams[1].c_str());
  } else {
    snprintf(a, sizeof(a), "Temp:%sC", gParams[2].c_str());
    char hms[9];
    // Countdown remaining time (same idea as the app Overview timer).
    formatRemainingHms(hmiRemainingDurationSec(), hms, sizeof(hms));
    snprintf(b, sizeof(b), "Left:%s", hms);
  }
  lcdLine(0, a);
  lcdLine(1, b);
}

static void renderStopOrPause() {
  if (!gLcdOk) return;
  // STOP left, PAUSE right — YES(E)=Pause, NO(S)=Stop+save
  lcdLine(0, "STOP        PAUSE");
  lcdLine(1, "NO(S)      YES(E)");
}

static void beginRunningUi() {
  gScreen = Screen::Running;
  gRunPage = 0;
  gRunPageMs = millis();
  renderRunning();
}

static void enterStopOrPausePrompt() {
  clearTap();
  gScreen = Screen::StopOrPause;
  renderStopOrPause();
  Serial.println("[hmi] STOP/PAUSE prompt");
}

static void actuallyStartDrying() {
  int total = gParams[1].toInt();
  float target = gParams[2].toFloat();
  long durationSec = durationDigitsToSeconds(gParams[3]);
  if (durationSec < 1) durationSec = 1;
  hmiOnStartDrying(gParams[0], total, target, (int)durationSec, 1);
  beginRunningUi();
  Serial.println("[hmi] drying started");
}

static void enterDoorWarn() {
  // Door already closed (or no working open reading) → start now
  if (!hmiDoorIsOpen()) {
    actuallyStartDrying();
    return;
  }
  gScreen = Screen::DoorWarn;
  gDoorCountLeft = HMI_DOOR_COUNTDOWN_S;
  gDoorTickMs = millis();
  renderDoorWarn();
}

static bool validateAllParams() {
  for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i].trim();
  for (uint8_t i = 0; i < PARAM_COUNT; i++) {
    // Duration may be empty digits but still shows 00:00:00 — require > 0 time
    if (i == 3) continue;
    if (!gParams[i].length()) {
      showMessage("Fill all params", "", 1200, Screen::EditParams);
      return false;
    }
  }
  int total = gParams[1].toInt();
  float target = gParams[2].toFloat();
  long durationSec = durationDigitsToSeconds(gParams[3]);
  if (total <= 0) {
    showMessage("Qty must be > 0", "", 1200, Screen::EditParams);
    return false;
  }
  if (target < 1.f || target > 120.f) {
    showMessage("Temp 1-120 C", "", 1200, Screen::EditParams);
    return false;
  }
  if (durationSec < 1) {
    showMessage("Set Duration", "", 1200, Screen::EditParams);
    return false;
  }
  return true;
}

static int keypadTestIndex(char key);
static void handleKey(char key);

static uint8_t keypadTestPressedCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < 16; i++) {
    if (gKeypadTestMask & (1u << i)) n++;
  }
  return n;
}

static int keypadTestIndex(char key) {
  for (int i = 0; i < 16; i++) {
    if (KEYPAD_TEST_KEYS[i] == key) return i;
  }
  return -1;
}

static void renderLcdSelfTest() {
  if (!gLcdOk) return;
  lcdCentered(0, "LCD IS WORKING!");
  lcdCentered(1, "");
}

static void renderKeypadSelfTest() {
  if (!gLcdOk) return;
  lcdCentered(0, "PLEASE CLICK");
  char buf[17];
  snprintf(buf, sizeof(buf), "ALL BTNS %u/16", (unsigned)keypadTestPressedCount());
  lcdCentered(1, buf);
}

static void redraw() {
  if (!gReady || !gLcdOk) return;
  if (gScreen == Screen::Start) renderStart();
  else if (gScreen == Screen::EditParams) renderEdit();
  else if (gScreen == Screen::ConfirmStart) renderConfirmStart();
  else if (gScreen == Screen::DoorWarn) renderDoorWarn();
  else if (gScreen == Screen::ContinueDoor) renderContinueDoor();
  else if (gScreen == Screen::Running) renderRunning();
  else if (gScreen == Screen::StopOrPause) renderStopOrPause();
  else if (gScreen == Screen::LcdSelfTest) renderLcdSelfTest();
  else if (gScreen == Screen::KeypadSelfTest) renderKeypadSelfTest();
}

inline bool isEnteringParams() {
  // Quiet while typing OR on STOP|PAUSE / short messages — keeps keys snappy.
  // Running sessions still heartbeats so the app stays Online.
  return gReady && (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart ||
                    gScreen == Screen::DoorWarn || gScreen == Screen::ContinueDoor ||
                    gScreen == Screen::StopOrPause || gScreen == Screen::Message);
}

inline bool wantsNetworkQuiet() {
  // Also give the keypad a short priority window right after any press so
  // the very first Enter / typed character is not lost to HTTPS polling.
  const bool recentKeyActivity =
      gLastKeypressMs != 0 && (millis() - gLastKeypressMs) < 1200UL;
  return isEnteringParams() || recentKeyActivity;
}

inline bool uiSelfTestActive() { return gUiSelfTestActive; }

inline uint8_t keypadSelfTestCount() { return keypadTestPressedCount(); }

inline uint16_t keypadSelfTestMask() { return gKeypadTestMask; }

inline String keypadSelfTestKeysCsv() {
  String out;
  out.reserve(32);
  for (uint8_t i = 0; i < 16; i++) {
    if (gKeypadTestMask & (1u << i)) {
      if (out.length()) out += ',';
      out += KEYPAD_TEST_KEYS[i];
    }
  }
  return out;
}

inline void endUiSelfTest() {
  if (!gUiSelfTestActive) return;
  gUiSelfTestActive = false;
  gLcdTestUntilMs = 0;
  gKeypadTestUntilMs = 0;
  gKeypadTestNoTimeout = false;
  keypad.setDebounceTime(50);
  const Screen ret =
      (gScreen == Screen::LcdSelfTest)     ? gLcdTestReturn
      : (gScreen == Screen::KeypadSelfTest) ? gKeypadTestReturn
                                            : Screen::Start;
  gScreen = ret;
  if (gScreen == Screen::Start) resetParams();
  redraw();
}

/** Show "LCD IS WORKING!" briefly (no countdown), then optional keypad phase. */
inline void startLcdSelfTest(unsigned long durationMs = 2000UL) {
  if (!gReady) return;
  if (gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest) {
    gLcdTestReturn = gScreen;
  }
  gUiSelfTestActive = true;
  gKeypadTestNoTimeout = false;
  gKeypadTestUntilMs = 0;
  gLcdTestUntilMs = millis() + (durationMs < 500UL ? 2000UL : durationMs);
  gLcdTestCountLeft = 0;  // no countdown display
  gLcdTestTickMs = millis();
  gScreen = Screen::LcdSelfTest;
  if (gLcdOk) {
    lcd.clear();
    renderLcdSelfTest();
    delay(20);
    renderLcdSelfTest();
  }
  Serial.println("[hmi] LCD self-test started (no countdown)");
}

/**
 * Prompt user to press every keypad button.
 * durationMs == 0 → no timeout; stays until all 16 keys OR endUiSelfTest().
 */
inline void startKeypadSelfTest(unsigned long durationMs = 0) {
  if (!gReady) return;
  if (gScreen != Screen::LcdSelfTest && gScreen != Screen::KeypadSelfTest) {
    gKeypadTestReturn = gScreen;
  }
  gUiSelfTestActive = true;
  gKeypadTestMask = 0;
  gKeypadTestLastCount = 0;
  gKeypadTestNoTimeout = (durationMs == 0);
  gKeypadTestUntilMs = gKeypadTestNoTimeout ? 0 : (millis() + durationMs);
  gScreen = Screen::KeypadSelfTest;
  // Faster debounce during test — 50ms was dropping quick taps.
  keypad.setDebounceTime(20);
  keypad.setHoldTime(200);
  if (gLcdOk) {
    lcd.clear();
    renderKeypadSelfTest();
    delay(20);
    renderKeypadSelfTest();
  }
  // Prime scan once (do NOT also call getKey — that eats the next edge).
  (void)keypad.getKeys();
  Serial.println("[hmi] Keypad self-test started — press ALL buttons (no countdown)");
}

/** Re-paint current self-test screen (call from main loop so message stays visible). */
inline void paintUiSelfTest() {
  if (!gUiSelfTestActive || !gLcdOk) return;
  if (gScreen == Screen::LcdSelfTest) renderLcdSelfTest();
  else if (gScreen == Screen::KeypadSelfTest) renderKeypadSelfTest();
}

/** Record one keypad-test key (idempotent). Returns true if newly counted. */
static bool registerKeypadTestKey(char key) {
  const int idx = keypadTestIndex(key);
  if (idx < 0) return false;
  const uint16_t bit = (uint16_t)(1u << idx);
  if (gKeypadTestMask & bit) return false;
  gKeypadTestMask |= bit;
  gKeypadOk = true;
  Serial.printf("[hmi] keypad test %u/16 key=%c\n",
                (unsigned)keypadTestPressedCount(), key);
  return true;
}

/** True while waiting for the user to finish the keypad (no auto timeout). */
inline bool keypadSelfTestWaiting() {
  return gUiSelfTestActive && gScreen == Screen::KeypadSelfTest && gKeypadTestNoTimeout;
}

inline bool keypadSelfTestActiveScreen() {
  return gScreen == Screen::KeypadSelfTest ||
         (gScreen == Screen::LcdSelfTest && gKeypadTestNoTimeout);
}

/**
 * Drain keypad.
 * During self-test: level-based (PRESSED/HOLD/RELEASED) so a missed PRESSED edge
 * still counts — fixes "have to press another key to register the previous one".
 * Never call getKeys()+getKey() together (getKey consumes the same edge).
 */
inline void pollKeypadFast() {
  if (!gReady) return;

#ifndef LIST_MAX
#define LIST_MAX 10
#endif

  if (keypadSelfTestActiveScreen()) {
    (void)keypad.getKeys();
    bool redrawNeeded = false;
    for (int i = 0; i < LIST_MAX; i++) {
      const char ch = keypad.key[i].kchar;
      if (ch == NO_KEY) continue;
      const KeyState st = keypad.key[i].kstate;
      // Count while down OR on release edge (catches presses missed during LCD I2C).
      if (st == PRESSED || st == HOLD ||
          (st == RELEASED && keypad.key[i].stateChanged)) {
        if (registerKeypadTestKey(ch)) redrawNeeded = true;
      }
    }
    if (redrawNeeded && gScreen == Screen::KeypadSelfTest) {
      renderKeypadSelfTest();
    }
    return;
  }

  // Normal HMI: drain several presses so a held/mashing user is not lagged by loop timing.
  for (uint8_t n = 0; n < 4; n++) {
    char key = keypad.getKey();
    if (!key) break;
    handleKey(key);
  }
}

/** LCD flash then keypad with NO timeout — user finishes all buttons. */
inline void startCombinedUiSelfTest(unsigned long /*totalMs*/ = 0) {
  // Brief LCD confirmation, then keypad until all 16 keys (or cloud clears test).
  startLcdSelfTest(1500UL);
  gKeypadTestMask = 0;
  gKeypadTestLastCount = 0;
  gKeypadTestNoTimeout = true;
  gKeypadTestUntilMs = 0;
  gKeypadTestReturn = gLcdTestReturn;
}

static void clearTap() {
  gTapKey = 0;
  gTapPos = 0;
  gTapMs = 0;
}

static void commitTapIfNeeded() {
  if (gTapKey && (millis() - gTapMs) > HMI_MULTITAP_MS) clearTap();
}

static void appendChar(char c) {
  if (gParamIdx == 3) {
    // Duration: digits only, max 6 → displayed as HH:MM:SS
    if (c < '0' || c > '9') return;
    if (gParams[3].length() >= 6) return;
    gParams[3] += c;
    return;
  }
  if (gParams[gParamIdx].length() >= 32) return;
  gParams[gParamIdx] += c;
}

static void backspace() {
  clearTap();
  if (gParams[gParamIdx].length()) gParams[gParamIdx].remove(gParams[gParamIdx].length() - 1);
}

static void phoneMultiTap(char digitChar) {
  int d = digitChar - '0';
  if (d < 1 || d > 9) return;
  const char* L = ALPHA_MAP[d];
  uint8_t n = (uint8_t)strlen(L);
  if (!n) return;

  String& s = gParams[gParamIdx];
  unsigned long now = millis();

  if (gTapKey == digitChar && (now - gTapMs) <= HMI_MULTITAP_MS) {
    gTapPos = (gTapPos + 1) % n;
    if (s.length()) s.setCharAt(s.length() - 1, L[gTapPos]);
    else s += L[gTapPos];
  } else {
    gTapKey = digitChar;
    gTapPos = 0;
    appendChar(L[0]);
  }
  gTapMs = now;
}

static void goNextParam() {
  clearTap();
  if (gParamIdx + 1 < PARAM_COUNT) {
    gParamIdx++;
    syncModeForParam();
  }
}

static void goPrevParam() {
  clearTap();
  if (gParamIdx > 0) {
    gParamIdx--;
    // Fish Name keeps last A/N choice; other params forced to N in syncModeForParam/render
  }
}

static void handleEnter() {
  clearTap();
  if (gScreen == Screen::Start) {
    gScreen = Screen::EditParams;
    gParamIdx = 0;
    gMode = InputMode::Alphabet;  // always Alphabet by default on Fish Name
    for (uint8_t i = 0; i < PARAM_COUNT; i++) gParams[i] = "";
    Serial.println("[hmi] -> Fish Name: (Alphabet)");
    redraw();
    return;
  }
  if (gScreen == Screen::ConfirmStart) {
    enterDoorWarn();
    return;
  }
  if (gScreen == Screen::ContinueDoor) {
    actuallyStartDrying();
    return;
  }
  if (gScreen == Screen::StopOrPause) {
    handlePauseYes();
    return;
  }
  if (gScreen == Screen::DoorWarn) return;
  if (gScreen == Screen::Running) return;
  if (gScreen != Screen::EditParams) return;

  String cur = gParams[gParamIdx];
  cur.trim();
  if (gParamIdx != 3 && !cur.length()) {
    showMessage("Enter a value", "", 1000, Screen::EditParams);
    return;
  }
  if (gParamIdx != 3) gParams[gParamIdx] = cur;
  if (gParamIdx + 1 < PARAM_COUNT) {
    gParamIdx++;
    syncModeForParam();
    redraw();
    return;
  }
  if (!validateAllParams()) return;
  gScreen = Screen::ConfirmStart;
  redraw();
}

static void handleStopOrNo() {
  clearTap();
  // NO(S) on confirm / continue / door — do not start
  if (gScreen == Screen::ConfirmStart || gScreen == Screen::ContinueDoor ||
      gScreen == Screen::DoorWarn) {
    gScreen = Screen::EditParams;
    gParamIdx = PARAM_COUNT - 1;
    syncModeForParam();
    redraw();
    Serial.println("[hmi] NO — cancelled start");
    return;
  }
  // Stop/Pause prompt: NO(S) = STOP and save history / queue if offline
  if (gScreen == Screen::StopOrPause) {
    hmiOnStopDrying();
    resetParams();
    showMessage("Stopped/Saved", "", 1500, Screen::Start);
    return;
  }
  // During drying (local or app): ask STOP vs PAUSE
  if (gScreen == Screen::Running || hmiSessionIsRunning() || hmiSessionIsPaused()) {
    enterStopOrPausePrompt();
  }
}

static void handlePauseYes() {
  clearTap();
  if (gScreen != Screen::StopOrPause) return;
  hmiOnPauseDrying();
  showMessage("PAUSED", "", 1200, Screen::Running);
  // After message returns to Running — keep params visible while paused
}

static void handleFinished() {
  clearTap();
  hmiOnDurationComplete();
  resetParams();
  showMessage("Finished/Saved", "", 2000, Screen::Start);
}

static const char* keyMeaning(char key) {
  switch (key) {
    case 'A': return "mode";
    case 'B': return "<-";
    case 'C': return "->";
    case 'D': return "Stop";
    case '0': return "Del";
    case '#': return "Enter";
    case '*': return (gMode == InputMode::Alphabet) ? "space" : "0";
    default: return "digit/letter";
  }
}

static void handleKey(char key) {
  gLastKeypressMs = millis();
  Serial.printf("[hmi] KEY=%c (%s) mode=%s\n", key, keyMeaning(key),
                gMode == InputMode::Alphabet ? "ALPHABET" : "NUMBER");
  gKeypadOk = true;

  // During keypad test OR combined LCD→keypad wait: count every raw key.
  if (gScreen == Screen::KeypadSelfTest ||
      (gScreen == Screen::LcdSelfTest && gKeypadTestNoTimeout)) {
    if (registerKeypadTestKey(key) && gScreen == Screen::KeypadSelfTest) {
      renderKeypadSelfTest();
    }
    return;
  }
  if (gScreen == Screen::LcdSelfTest) {
    return;
  }

  if (key == 'A') {
    if (gScreen == Screen::EditParams && gParamIdx == 0) {
      clearTap();
      gMode = (gMode == InputMode::Alphabet) ? InputMode::Numeric : InputMode::Alphabet;
      Serial.printf("[hmi] mode=%s\n", gMode == InputMode::Alphabet ? "ALPHABET" : "NUMBER");
      redraw();
    }
    return;
  }
  if (key == 'B') {
    if (gScreen == Screen::EditParams) {
      goPrevParam();
      redraw();
    }
    return;
  }
  if (key == 'C') {
    if (gScreen == Screen::EditParams) {
      goNextParam();
      redraw();
    }
    return;
  }
  if (key == 'D') {
    handleStopOrNo();
    return;
  }
  // Enter = raw '#' (3rd bottom). On START only, raw '0' also Enter
  // so one press opens Fish Name (no random key mashing).
  if (key == '#') {
    handleEnter();
    return;
  }
  if (key == '0') {
    if (gScreen == Screen::Start) {
      handleEnter();
      return;
    }
    if (gScreen == Screen::EditParams) {
      backspace();
      redraw();
    }
    return;
  }

  // Start screen: only Enter proceeds — ignore other keys
  if (gScreen == Screen::Start) {
    return;
  }
  if (gScreen == Screen::ConfirmStart || gScreen == Screen::ContinueDoor ||
      gScreen == Screen::DoorWarn || gScreen == Screen::Running ||
      gScreen == Screen::StopOrPause || gScreen == Screen::Message) {
    return;
  }
  if (gScreen != Screen::EditParams) return;

  if (key == '*') {
    clearTap();
    appendChar(gMode == InputMode::Alphabet ? ' ' : '0');
    redraw();
    return;
  }

  if (key >= '1' && key <= '9') {
    if (gMode == InputMode::Alphabet) {
      phoneMultiTap(key);
    } else {
      clearTap();
      appendChar(key);
    }
    redraw();
  }
}

inline void begin() {
  Serial.println("[hmi] === LOCAL HMI READY ===");
  Serial.println("[hmi] boot: START DRYING SESSION -> Enter -> Fish Name (Alphabet)");
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  Wire.setClock(100000);
  delay(30);

  gLcdOk = false;
  uint8_t addrs[] = {LCD_I2C_ADDR, 0x3F, 0x27};
  for (uint8_t i = 0; i < 3; i++) {
    if (lcd.begin(addrs[i])) {
      gLcdOk = true;
      Serial.printf("[hmi] LCD @0x%02X\n", addrs[i]);
      break;
    }
  }

  keypad.setDebounceTime(20);
  keypad.setHoldTime(400);

  gKeypadOk = true;
  gReady = true;
  gScreen = Screen::Start;
  resetParams();
  gMode = InputMode::Alphabet;
  if (gLcdOk) {
    lcd.clear();
    renderStart();
    delay(50);
    renderStart();  // second paint — some I2C LCDs miss the first
  }
}

inline bool lcdWorking() { return gLcdOk; }
inline bool keypadWorking() { return gKeypadOk; }

inline void poll() {
  if (!gReady) return;
  commitTapIfNeeded();

  if (gScreen == Screen::Message && (long)(millis() - gMessageUntilMs) >= 0) {
    gScreen = gMessageReturn;
    if (gScreen == Screen::Start) resetParams();
    redraw();
  }

  // LCD self-test: brief "LCD IS WORKING!" then keypad (no countdown).
  if (gScreen == Screen::LcdSelfTest) {
    if ((long)(millis() - gLcdTestUntilMs) >= 0) {
      if (gKeypadTestNoTimeout) {
        gScreen = Screen::KeypadSelfTest;
        keypad.setDebounceTime(20);
        keypad.setHoldTime(200);
        (void)keypad.getKeys();  // prime only — do not call getKey()
        if (gLcdOk) {
          lcd.clear();
          renderKeypadSelfTest();
        }
        Serial.println("[hmi] LCD done → keypad (wait for all buttons)");
      } else {
        endUiSelfTest();
      }
    }
  }

  // Keypad self-test: no timeout when gKeypadTestNoTimeout — finish at 16/16 only.
  if (gScreen == Screen::KeypadSelfTest) {
    if (keypadTestPressedCount() >= 16) {
      Serial.println("[hmi] keypad test COMPLETE 16/16");
      if (gLcdOk) {
        lcd.clear();
        lcdCentered(0, "KEYPAD OK!");
        lcdCentered(1, "16/16 DONE");
      }
      // Keep screen briefly; cloud/mobile ends the command.
      gKeypadTestNoTimeout = false;
      gKeypadTestUntilMs = millis() + 1500UL;
    } else if (!gKeypadTestNoTimeout && gKeypadTestUntilMs != 0 &&
               (long)(millis() - gKeypadTestUntilMs) >= 0) {
      endUiSelfTest();
    }
  }

  // Door open warn: auto-start if door closes; else countdown → CONTINUE?
  if (gScreen == Screen::DoorWarn) {
    if (!hmiDoorIsOpen()) {
      actuallyStartDrying();
    } else if (millis() - gDoorTickMs >= 1000UL) {
      gDoorTickMs = millis();
      if (gDoorCountLeft > 0) gDoorCountLeft--;
      if (gDoorCountLeft == 0) {
        gScreen = Screen::ContinueDoor;
        renderContinueDoor();
      } else {
        renderDoorWarn();
      }
    }
  }

  // Rotate FISH/Qty <-> Temp/Left every 5s while drying; refresh countdown 1 Hz
  if (gScreen == Screen::Running && (hmiSessionIsRunning() || hmiSessionIsPaused())) {
    if (hmiSessionIsRunning() && hmiLocalDurationExpired()) {
      handleFinished();
    } else if (millis() - gRunPageMs >= HMI_PARAM_ROTATE_MS) {
      gRunPageMs = millis();
      gRunPage = (gRunPage == 0) ? 1 : 0;
      gRunTickMs = millis();
      renderRunning();
    } else if (gRunPage == 1 && hmiSessionIsRunning() &&
               (millis() - gRunTickMs >= 1000UL)) {
      gRunTickMs = millis();
      renderRunning();
    }
  } else if (gScreen == Screen::Running && !hmiSessionIsRunning() &&
             !hmiSessionIsPaused()) {
    // External stop (app / cloud)
    resetParams();
    gScreen = Screen::Start;
    redraw();
  }

  // Always drain keypad — especially critical during self-test.
  pollKeypadFast();
}

/**
 * Dedicated keypad-test service: call from loop while waiting for all buttons.
 * Returns false if test ended (complete / cancelled / not in keypad test).
 */
inline bool serviceKeypadSelfTestSlice() {
  if (!keypadSelfTestWaiting()) return false;
  poll();
  return keypadSelfTestWaiting();
}

/** App/cloud started a session — show the same rotating LCD params. */
inline void adoptCloudSession(const String& fishType, int totalFish, float targetC,
                              int durationSec) {
  if (!gReady) return;
  if (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart ||
      gScreen == Screen::DoorWarn || gScreen == Screen::ContinueDoor) {
    return;  // don't interrupt local param entry
  }
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest ||
      gScreen == Screen::StopOrPause) {
    return;
  }
  if (fishType.length() > 0) gParams[0] = fishType;
  gParams[1] = String(totalFish < 0 ? 0 : totalFish);
  {
    char tbuf[12];
    snprintf(tbuf, sizeof(tbuf), "%.0f", targetC);
    gParams[2] = String(tbuf);
  }
  long sec = durationSec < 1 ? 1 : durationSec;
  long hh = sec / 3600L;
  long mm = (sec % 3600L) / 60L;
  long ss = sec % 60L;
  char dbuf[12];
  snprintf(dbuf, sizeof(dbuf), "%02ld%02ld%02ld", hh > 99 ? 99 : hh, mm, ss);
  gParams[3] = String(dbuf);
  if (gScreen == Screen::Running || gScreen == Screen::Message) {
    return;  // already on drying UI — don't reset rotate page every poll
  }
  beginRunningUi();
}

inline void adoptCloudPaused() {
  if (!gReady) return;
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest) return;
  if (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart ||
      gScreen == Screen::DoorWarn || gScreen == Screen::ContinueDoor) {
    return;
  }
  if (gScreen != Screen::Running && gScreen != Screen::StopOrPause &&
      gScreen != Screen::Message) {
    beginRunningUi();
  }
  showMessage("PAUSED", "", 1000, Screen::Running);
}

inline void adoptCloudStopped() {
  if (!gReady) return;
  if (gScreen == Screen::LcdSelfTest || gScreen == Screen::KeypadSelfTest) return;
  if (gScreen == Screen::EditParams || gScreen == Screen::ConfirmStart) return;
  resetParams();
  gScreen = Screen::Start;
  redraw();
}

}  // namespace LocalHmi

#else

namespace LocalHmi {
inline void begin() {}
inline void poll() {}
inline bool lcdWorking() { return false; }
inline bool keypadWorking() { return false; }
inline bool isEnteringParams() { return false; }
inline bool wantsNetworkQuiet() { return false; }
inline bool uiSelfTestActive() { return false; }
inline uint8_t keypadSelfTestCount() { return 0; }
inline uint16_t keypadSelfTestMask() { return 0; }
inline String keypadSelfTestKeysCsv() { return String(); }
inline void endUiSelfTest() {}
inline void startLcdSelfTest(unsigned long = 2000UL) {}
inline void startKeypadSelfTest(unsigned long = 0) {}
inline void startCombinedUiSelfTest(unsigned long = 0) {}
inline void paintUiSelfTest() {}
inline bool keypadSelfTestWaiting() { return false; }
inline void pollKeypadFast() {}
inline bool serviceKeypadSelfTestSlice() { return false; }
inline void adoptCloudSession(const String&, int, float, int) {}
inline void adoptCloudPaused() {}
inline void adoptCloudStopped() {}
}

#endif
