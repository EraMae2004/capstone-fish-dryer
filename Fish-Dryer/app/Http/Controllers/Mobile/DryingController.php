<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Services\FirebaseRealtimeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Carbon;
use App\Models\Microcontroller;
use App\Models\DryingSession;
use App\Models\MachineHardwareStatus;
use App\Models\Notification;
use App\Models\SensorLog;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;


class DryingController extends Controller
{
    /**
     * Heartbeat + detect use the same recency window so the app doesn't "lose" boards
     * during short WiFi drops while still marking long-absent boards offline.
     */
    /** Heartbeat recency for "online" — wider window helps flaky campus Wi‑Fi / ESP reboots. */
    /** Presence window: after this with no heartbeat, API reports offline (mobile RTDB uses ~12s). */
    private const ONLINE_LAST_SEEN_MINUTES = 3;

    /** Match mobile RTDB offline grace — ESP pushes `hardware_status` every ~2s when Wi‑Fi is up. */
    private const ONLINE_RTDB_GRACE_SECONDS = 60;

    private function machineDisplayName(Microcontroller $machine): string
    {
        $display = trim((string) ($machine->display_name ?? ''));
        return $display !== '' ? $display : (string) $machine->device_id;
    }

    /**
     * ESP32 only runs fan/heaters/buzzer from RTDB `machines/{id}/session` (not Laravel MySQL).
     * Mirror every start/pause/stop here so the board always receives the command.
     */
    private function syncEspSessionToFirebase(
        int $microcontrollerId,
        string $status,
        ?float $targetTemperature = null,
        ?int $fanSpeed = null
    ): void {
        try {
            $firebase = app(FirebaseRealtimeService::class);
            if (! $firebase->isEnabled()) {
                return;
            }

            $st = strtolower(trim($status));
            $running = $st === 'running';
            $paused = $st === 'paused';
            $tt = $targetTemperature !== null ? (float) $targetTemperature : 0.0;
            if ($running || $paused) {
                if ($tt <= 1.0) {
                    $tt = 60.0;
                }
            } else {
                $tt = 0.0;
            }

            $fs = $fanSpeed !== null ? (int) $fanSpeed : 1;
            if ($fs < 1 || $fs > 3) {
                $fs = 1;
            }

            $command = match ($st) {
                'running' => 'start',
                'paused' => 'pause',
                'stopped' => 'stop',
                default => $st,
            };

            $firebase->setMachineSession($microcontrollerId, [
                'command' => $command,
                'status' => $st,
                'target_temperature' => $tt,
                'fan_speed' => $fs,
                'fault_buzzer_armed' => $running,
                'session_active' => $running,
                'updated_at' => now()->toIso8601String(),
            ]);

            $firebase->setMachineCommand($microcontrollerId, [
                'action' => $command,
                'fan_speed' => $fs,
                'target_temperature' => $tt,
                'seq' => (int) round(microtime(true) * 1000),
                'updated_at' => now()->toIso8601String(),
            ]);

            $machine = Microcontroller::find($microcontrollerId);
            $macHex = $machine ? $this->normalizeHardwareMac($machine->mac ?? $machine->device_id ?? null) : null;
            if ($macHex) {
                $firebase->setDeviceAssignment($macHex, [
                    'microcontroller_id' => $microcontrollerId,
                    'mac' => implode(':', str_split($macHex, 2)),
                    'updated_at' => now()->toIso8601String(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('firebase_session_sync_failed', [
                'microcontroller_id' => $microcontrollerId,
                'status' => $status,
                'message' => $e->getMessage(),
            ]);
        }
    }

    /** Normalize Wi‑Fi MAC to 12 lowercase hex (no colons) for `microcontrollers.mac`. */
    private function normalizeHardwareMac(?string $mac): ?string
    {
        if ($mac === null || trim((string) $mac) === '') {
            return null;
        }
        $hex = strtolower(preg_replace('/[^0-9a-f]/i', '', (string) $mac));

        return strlen($hex) === 12 ? $hex : null;
    }

    /** 12-char hex MAC → `aa:bb:cc:dd:ee:ff` for JSON payloads. */
    private function formatMacForDisplay(string $normalized12): string
    {
        $h = strtolower(preg_replace('/[^0-9a-f]/', '', $normalized12));
        if (strlen($h) !== 12) {
            return $normalized12;
        }

        return implode(':', str_split($h, 2));
    }

    private function microcontrollersHasMacColumn(): bool
    {
        return Schema::hasTable('microcontrollers') && Schema::hasColumn('microcontrollers', 'mac');
    }

    /**
     * Canonical component_name values we persist (must stay within DB enum).
     *
     * @return list<string>
     */
    private function canonicalHardwareComponentKeys(): array
    {
        return [
            'esp32',
            'heater_1',
            'heater_2',
            'fan_1',
            'fan_2',
            'fan_3',
            'buzzer',
            'led_1',
            'led_2',
            'led_3',
            'dht22',
            'moisture_sensor',
            'door_sensor',
        ];
    }

    /**
     * Sensor-only keys written to Firebase `machines/{id}/hardware_status/components`
     * and used for Overview hardware rows — must match firmware RTDB publish order/keys.
     *
     * @return list<string>
     */
    private function firebaseSensorHardwareComponentKeys(): array
    {
        return ['esp32', 'door_sensor', 'moisture_sensor', 'dht22'];
    }

    private function coerceComponentStatus(mixed $status): string
    {
        if (is_bool($status)) {
            return $status ? 'working' : 'not_working';
        }
        if (is_int($status) || is_float($status)) {
            // Only treat binary 0/1 as hardware flags. Numeric telemetry (e.g. 32.4) must NOT become "working".
            $n = (float) $status;
            if (abs($n) <= 0.000001) {
                return 'not_working';
            }
            if (abs($n - 1.0) <= 0.000001) {
                return 'working';
            }

            return 'not_working';
        }
        if (is_array($status)) {
            // Never infer "working" from arbitrary nested structures.
            return 'not_working';
        }

        $value = strtolower(trim((string) $status));

        return match ($value) {
            'working', 'ok', 'on', 'online', 'connected', 'active', 'true', '1', 'yes', 'up', 'good', 'present', 'detected' => 'working',
            'warning', 'warn', 'degraded' => 'warning',
            'not_working', 'off', 'false', '0', 'no', 'error', 'fail', 'failed', 'disconnected', 'bad', 'offline', 'down', 'absent', 'missing' => 'not_working',
            // Never guess "working" for unknown strings — that makes the UI look random/wrong.
            default => 'not_working',
        };
    }

    /**
     * Map arbitrary ESP / frontend labels to a canonical DB component_name, or null if unknown.
     */
    private function normalizeHardwareComponentKey(string $raw): ?string
    {
        $key = strtolower((string) preg_replace('/[^a-z0-9]+/i', '_', trim($raw)));
        $key = trim($key, '_');

        $allowed = [
            'esp32',
            'heater_1',
            'heater_2',
            'fan_1',
            'fan_2',
            'fan_3',
            'buzzer',
            'led_1',
            'led_2',
            'led_3',
            'dht22',
            'moisture_sensor',
            'door_sensor',
        ];

        return match ($key) {
            'esp32', 'esp_32', 'esp', 'controller', 'mcu', 'microcontroller' => 'esp32',

            'buzzer', 'buzz', 'beep', 'beeper' => 'buzzer',

            // MC38 reed switch (door sensor)
            'door_sensor', 'door', 'door_switch', 'door_contact', 'contact_switch',
            'reed_switch', 'reed', 'magnetic_switch', 'mc38', 'mc_38' => 'door_sensor',

            'heater_1', 'heater1', 'h1', 'heat1', 'heating_1', 'heating1', 'relay_1', 'relay1', 'rly1', 'ssr1' => 'heater_1',
            'heater_2', 'heater2', 'h2', 'heat2', 'heating_2', 'heating2', 'relay_2', 'relay2', 'rly2', 'ssr2' => 'heater_2',

            // Fans: canonical keys are fan_1..fan_3 (maps legacy heater_fan / ventilation too)
            'fan_1', 'fan1', 'heater_fan_1', 'hf1', 'h_fan_1', 'drying_fan_1', 'hot_fan_1' => 'fan_1',
            'fan_2', 'fan2', 'heater_fan_2', 'hf2', 'h_fan_2', 'drying_fan_2', 'hot_fan_2' => 'fan_2',
            'fan_3', 'fan3', 'ventilation_fan', 'vf', 'vent_fan', 'exhaust', 'exhaust_fan', 'cooling_fan', 'vent_fan_1', 'fan' => 'fan_3',

            'led_1', 'led1', 'led_drying', 'drying_led' => 'led_1',
            'led_2', 'led2', 'led_pause', 'pause_led' => 'led_2',
            'led_3', 'led3', 'led_stop', 'stop_led' => 'led_3',

            // DHT22 is one physical sensor with temp+humidity outputs.
            'dht22', 'dht11', 'dht', 'dht_22', 'dht_11', 'temp_humidity_sensor',
            'temperature_and_humidity_sensor', 'temp_sensor', 'humidity_sensor', 'temperature_sensor',
            'temp_humidity', 'rh_temp', 'ambient', 'env_sensor' => 'dht22',

            // Moisture sensor (YL-69) is a single component.
            'moisture_sensor', 'moisture', 'yl69', 'yl_69', 'soil_moisture' => 'moisture_sensor',

            // Accept legacy names but never persist them as canonical enum values.
            'temp_humidity_sensor' => 'dht22',
            'moisture_sensor_1' => 'moisture_sensor',
            'moisture_sensor_2' => 'moisture_sensor',
            'led_drying' => 'led_1',
            'led_pause' => 'led_2',
            'led_stop' => 'led_3',

            default => in_array($key, $allowed, true) ? $key : null,
        };
    }

    /**
     * @return array<string, string> canonical component_name => working|warning|not_working
     */
    private function parseHeartbeatComponentPayload(mixed $incoming): array
    {
        if ($incoming === null) {
            return [];
        }
        if (is_string($incoming)) {
            $trim = trim($incoming);
            if ($trim === '') {
                return [];
            }
            // Double-encoded JSON string: "\"{\\\"heater_1\\\":\\\"ok\\\"}\""
            if ($trim[0] === '"' && str_ends_with($trim, '"')) {
                $once = json_decode($trim, true);
                if (is_string($once)) {
                    $twice = json_decode($once, true);
                    if (is_array($twice)) {
                        return $this->parseHeartbeatComponentPayload($twice);
                    }
                }
            }
            // Comma-separated names: "esp32,dht22,heater_1"
            if ($trim[0] !== '{' && $trim[0] !== '[' && str_contains($trim, ',')) {
                $parts = array_map('trim', explode(',', $trim));
                $parts = array_values(array_filter($parts, fn ($p) => $p !== ''));

                return $this->parseHeartbeatComponentPayload($parts);
            }
            $decoded = json_decode($trim, true);
            if (is_array($decoded)) {
                return $this->parseHeartbeatComponentPayload($decoded);
            }

            $single = $this->normalizeHardwareComponentKey($trim);

            return $single !== null ? [$single => 'working'] : [];
        }
        if (! is_array($incoming)) {
            return [];
        }

        $out = [];

        if (array_is_list($incoming)) {
            foreach ($incoming as $item) {
                if (is_string($item) || is_int($item) || is_float($item)) {
                    $canonical = $this->normalizeHardwareComponentKey((string) $item);
                    if ($canonical !== null) {
                        $out[$canonical] = 'working';
                    }

                    continue;
                }
                if (! is_array($item)) {
                    continue;
                }

                $name = $item['name']
                    ?? $item['component']
                    ?? $item['component_name']
                    ?? $item['id']
                    ?? $item['type']
                    ?? $item['key']
                    ?? $item['sensor']
                    ?? null;
                if ($name === null) {
                    continue;
                }

                $canonical = $this->normalizeHardwareComponentKey((string) $name);
                if ($canonical === null) {
                    continue;
                }

                $rawStatus = $item['status']
                    ?? $item['state']
                    ?? $item['value']
                    ?? $item['connected']
                    ?? $item['ok']
                    ?? 'working';

                $out[$canonical] = $this->coerceComponentStatus($rawStatus);
            }

            return $out;
        }

        foreach ($incoming as $name => $status) {
            if (is_int($name) && (is_string($status) || is_int($status) || is_float($status))) {
                $canonical = $this->normalizeHardwareComponentKey((string) $status);
                if ($canonical !== null) {
                    $out[$canonical] = 'working';
                }

                continue;
            }
            if (! is_string($name) && ! is_int($name)) {
                continue;
            }

            $canonical = $this->normalizeHardwareComponentKey((string) $name);
            if ($canonical === null) {
                continue;
            }

            $out[$canonical] = $this->coerceComponentStatus($status);
        }

        return $out;
    }

    /**
     * Some firmware posts hardware keys at the JSON root (not only under "components").
     *
     * @param  array<string, mixed>  $decodedRoot
     * @param  array<string, string>  $statusMap
     */
    private function mergeRootLevelHardwareIntoStatusMap(array $decodedRoot, array $statusMap): array
    {
        $reserved = [
            'device_id', 'created_by', 'components', 'component', 'hardware', 'sensors',
            'parts', 'connected', 'hardwarelist',
            'component_status', 'status', 'states', 'devices', 'readings',
            'gpio_states', 'components_report', 'attached', 'detected',
            'data', 'payload', 'body', 'result',
            'success', 'message', 'timestamp', 'ts', 'token', 'api_key', 'user_id',
            'microcontroller_id', 'mc_id', 'machine_id',
        ];

        $looksLikeTelemetryScalar = function (mixed $v): bool {
            // Prevent "temperature": 32.4 from being interpreted as a component status.
            if (is_int($v)) {
                return $v !== 0 && $v !== 1;
            }
            if (is_float($v)) {
                // Treat only strict 0.0/1.0 as boolean-ish hardware flags.
                return abs($v) > 0.000001 && abs($v - 1.0) > 0.000001;
            }
            if (is_string($v)) {
                $t = trim($v);
                if ($t === '') {
                    return false;
                }
                if ($t === '0' || $t === '1') {
                    return false;
                }
                if (is_numeric($t)) {
                    return true;
                }
            }

            return false;
        };

        foreach ($decodedRoot as $k => $v) {
            if (! is_string($k) && ! is_int($k)) {
                continue;
            }
            $key = strtolower((string) $k);
            if (in_array($key, $reserved, true)) {
                continue;
            }

            $canonical = $this->normalizeHardwareComponentKey((string) $k);
            if ($canonical === null) {
                continue;
            }

            // Never infer hardware presence from nested objects/arrays at the JSON root.
            // Those are almost always telemetry blobs, not component state maps.
            if (is_array($v)) {
                continue;
            }
            if ($looksLikeTelemetryScalar($v)) {
                continue;
            }

            if (! isset($statusMap[$canonical])) {
                $statusMap[$canonical] = $this->coerceComponentStatus($v);
            }
        }

        return $statusMap;
    }

    /**
     * Merge raw JSON body with Laravel-parsed input (fixes empty json_decode when
     * Content-Type is not JSON, form fields, or body already consumed into Request).
     *
     * @return array<string, mixed>
     */
    private function buildMergedHeartbeatPayloadTree(Request $request): array
    {
        $rawBody = (string) $request->getContent();
        $fromJson = json_decode($rawBody, true);
        if (! is_array($fromJson)) {
            /**
             * Some embedded HTTP stacks occasionally send extra bytes before/after JSON,
             * or the body arrives with BOM/non-printable chars. Try to salvage the JSON
             * object by extracting the outermost {...} or [...] segment.
             */
            $trim = trim($rawBody);
            $salvaged = null;

            $firstObj = strpos($trim, '{');
            $lastObj = strrpos($trim, '}');
            if ($firstObj !== false && $lastObj !== false && $lastObj > $firstObj) {
                $candidate = substr($trim, $firstObj, $lastObj - $firstObj + 1);
                $decoded = json_decode($candidate, true);
                if (is_array($decoded)) {
                    $salvaged = $decoded;
                }
            }

            if ($salvaged === null) {
                $firstArr = strpos($trim, '[');
                $lastArr = strrpos($trim, ']');
                if ($firstArr !== false && $lastArr !== false && $lastArr > $firstArr) {
                    $candidate = substr($trim, $firstArr, $lastArr - $firstArr + 1);
                    $decoded = json_decode($candidate, true);
                    if (is_array($decoded)) {
                        $salvaged = $decoded;
                    }
                }
            }

            $fromJson = is_array($salvaged) ? $salvaged : [];
        }

        $fromLaravel = $request->all();
        if (! is_array($fromLaravel)) {
            $fromLaravel = [];
        }

        // Prefer raw JSON body over $request->all() when keys overlap (avoids empty form fields
        // shadowing a valid JSON "components" payload).
        return array_replace($fromLaravel, $fromJson);
    }

    /**
     * If a field is a JSON string (common from form posts / Arduino), decode it in-place
     * for top-level keys and inside common wrapper objects.
     *
     * @param  array<string, mixed>  $tree
     * @return array<string, mixed>
     */
    private function expandHeartbeatTreeJsonStringValues(array $tree): array
    {
        $decodeIfJsonString = function (mixed $v): mixed {
            if (! is_string($v)) {
                return $v;
            }
            $t = trim($v);
            if ($t === '' || ($t[0] !== '{' && $t[0] !== '[')) {
                return $v;
            }
            $d = json_decode($t, true);

            return is_array($d) ? $d : $v;
        };

        $payloadKeys = [
            'components', 'component', 'parts', 'connected', 'hardware', 'sensors',
            'component_status', 'status', 'states', 'devices',
            'gpio_states', 'components_report', 'attached', 'detected',
        ];

        foreach ($payloadKeys as $k) {
            if (array_key_exists($k, $tree)) {
                $tree[$k] = $decodeIfJsonString($tree[$k]);
            }
        }

        foreach (['data', 'payload', 'body', 'result'] as $wrap) {
            if (! isset($tree[$wrap]) || ! is_array($tree[$wrap])) {
                continue;
            }
            foreach ($payloadKeys as $k) {
                if (array_key_exists($k, $tree[$wrap])) {
                    $tree[$wrap][$k] = $decodeIfJsonString($tree[$wrap][$k]);
                }
            }
        }

        return $tree;
    }

    /**
     * Collect every payload shape that might carry the component list.
     *
     * @param  array<string, mixed>  $tree
     * @return list<mixed>
     */
    private function collectHeartbeatComponentPayloads(array $tree): array
    {
        $chunks = [];

        $push = function (mixed $v) use (&$chunks): void {
            if ($v === null || $v === '') {
                return;
            }
            $chunks[] = $v;
        };

        // Never treat `readings` as a component map: keys like `door` ("open"/"closed") normalize
        // to `door_sensor` and coerce to `not_working`, overwriting real `components.{...}`.
        $chunkKeys = [
            'components', 'component', 'parts', 'connected', 'hardware', 'sensors',
            'component_status', 'states', 'devices',
            'gpio_states', 'components_report', 'attached', 'detected',
        ];

        foreach ($chunkKeys as $k) {
            if (array_key_exists($k, $tree)) {
                $push($tree[$k]);
            }
        }

        foreach (['data', 'payload', 'body', 'result'] as $wrap) {
            if (! isset($tree[$wrap]) || ! is_array($tree[$wrap])) {
                continue;
            }
            $inner = $tree[$wrap];
            foreach ($chunkKeys as $k) {
                if (array_key_exists($k, $inner)) {
                    $push($inner[$k]);
                }
            }
        }

        return $chunks;
    }

    public function esp32Heartbeat(Request $request)
    {
        $userId = (int) ($request->input('created_by') ?? 0);
        if ($userId <= 0) {
            $userId = (int) (DB::table('users')->min('id') ?? 1);
        }

        // Build merged/expanded payload first so we can read device id keys even when firmware
        // uses non-standard names or posts JSON as a string.
        $decodedRoot = $this->expandHeartbeatTreeJsonStringValues(
            $this->buildMergedHeartbeatPayloadTree($request)
        );

        $debugEnabled = (bool) (env('HEARTBEAT_DEBUG') ?: false);
        $rawBody = $debugEnabled ? (string) $request->getContent() : '';
        $decodedRootKeys = $debugEnabled ? array_keys($decodedRoot) : [];
        $laravelAll = $debugEnabled ? $request->all() : [];

        $readFirstNonEmptyString = function (array $tree, array $keys): ?string {
            foreach ($keys as $k) {
                if (!array_key_exists($k, $tree)) {
                    continue;
                }
                $v = $tree[$k];
                if ($v === null) {
                    continue;
                }
                if (is_string($v)) {
                    $t = trim($v);
                    if ($t !== '') return $t;
                } elseif (is_int($v) || is_float($v)) {
                    return (string) $v;
                }
            }
            return null;
        };

        // Accept common firmware keys for the hardware identity.
        $deviceId = $readFirstNonEmptyString($decodedRoot, [
            'device_id',
            'deviceId',
            'deviceID',
            'DEVICE_ID',
            'id',
            'board_id',
            'boardId',
            'chip_id',
            'chipId',
            'mac',
            'mac_address',
            'macAddress',
        ]);

        // Fallback to Laravel input() for form-encoded posts.
        if ($deviceId === null) {
            $deviceId = (string) $request->input('device_id', '');
            $deviceId = trim($deviceId);
        }

        // Last resort default (keeps older sketches working).
        if ($deviceId === '') {
            $deviceId = 'esp32-1';
        }

        $wifiMacRaw = $readFirstNonEmptyString($decodedRoot, [
            'mac', 'mac_address', 'macAddress', 'MAC', 'wifi_mac', 'wifiMac',
        ]);
        $wifiMacNorm = $this->normalizeHardwareMac($wifiMacRaw);

        // Prefer explicit DB row id from the app/firmware so heartbeats hit the same row
        // the user "saved", even if device_id strings drift across sketches.
        $machine = null;
        $mcId = $request->input('microcontroller_id', $request->input('mc_id', $request->input('machine_id')));
        if ($mcId !== null && $mcId !== '' && is_numeric($mcId) && (int) $mcId > 0) {
            $candidate = Microcontroller::find((int) $mcId);
            // Explicit numeric id always wins — do not require device_id to match (sketches
            // often send a friendly label while DB still has a hardware id string).
            if ($candidate) {
                $machine = $candidate;
            }
        }

        if (! $machine && $wifiMacNorm && $this->microcontrollersHasMacColumn()) {
            $machine = Microcontroller::where('mac', $wifiMacNorm)->first();
        }

        if (! $machine) {
            $machine = Microcontroller::where('device_id', $deviceId)->first();
        }

        // Recovery fallback: if one board already exists and user renamed device_id,
        // still treat incoming heartbeat as that board so online status keeps working.
        if (!$machine) {
            $count = Microcontroller::count();
            if ($count === 1) {
                $machine = Microcontroller::first();
            }
        }

        // If firmware is frozen on default `device_id=esp32-1` but the saved row uses another
        // string, bind heartbeats to an explicit DB row via .env (no firmware change).
        if (! $machine) {
            $fallbackId = (int) (env('HEARTBEAT_FALLBACK_MICROCONTROLLER_ID') ?: 0);
            if ($fallbackId > 0) {
                $machine = Microcontroller::find($fallbackId);
            }
        }

        if (!$machine) {
            $row = [
                'device_id' => $deviceId,
                'created_by' => $userId,
                'last_seen' => null,
            ];
            if ($wifiMacNorm && $this->microcontrollersHasMacColumn()) {
                $row['mac'] = $wifiMacNorm;
            }
            $machine = Microcontroller::create($row);
        } elseif ($wifiMacNorm && $this->microcontrollersHasMacColumn() && (string) ($machine->mac ?? '') === '') {
            try {
                $machine->mac = $wifiMacNorm;
                $machine->save();
            } catch (\Throwable) {
                // Another row already owns this MAC.
            }
        }

        $statusMap = [];
        foreach ($this->collectHeartbeatComponentPayloads($decodedRoot) as $chunk) {
            $statusMap = array_replace($statusMap, $this->parseHeartbeatComponentPayload($chunk));
        }

        // Nested objects some firmware uses: { "hardware": { "heater_1": "ok" } }
        $nestedObjectKeys = [
            'hardware', 'sensors', 'component_status', 'status', 'states', 'devices',
            'gpio_states', 'components_report', 'attached', 'detected',
        ];
        foreach ($nestedObjectKeys as $nestedKey) {
            if (isset($decodedRoot[$nestedKey]) && is_array($decodedRoot[$nestedKey])) {
                $statusMap = array_replace(
                    $statusMap,
                    $this->parseHeartbeatComponentPayload($decodedRoot[$nestedKey])
                );
            }
        }

        foreach (['data', 'payload', 'body', 'result'] as $wrap) {
            if (! isset($decodedRoot[$wrap]) || ! is_array($decodedRoot[$wrap])) {
                continue;
            }
            $inner = $decodedRoot[$wrap];
            foreach ($nestedObjectKeys as $nestedKey) {
                if (isset($inner[$nestedKey]) && is_array($inner[$nestedKey])) {
                    $statusMap = array_replace(
                        $statusMap,
                        $this->parseHeartbeatComponentPayload($inner[$nestedKey])
                    );
                }
            }
        }

        if ($decodedRoot !== []) {
            $statusMap = $this->mergeRootLevelHardwareIntoStatusMap($decodedRoot, $statusMap);
        }

        $defaultComponents = $this->canonicalHardwareComponentKeys();

        /**
         * Successful HTTP heartbeat means the MCU reached Laravel — same notion as mobile
         * "machine online". Always mark ESP32 `working` here; sensor rows still come from
         * firmware `components` (dht22, door_sensor, moisture_sensor).
         */
        $statusMap['esp32'] = 'working';

        /**
         * Enforce deterministic "detection" semantics for the mobile UI:
         * - If ESP reports a component key => WORKING/WARNING/NOT_WORKING (coerced)
         * - If ESP does NOT report a component key => NOT_WORKING
         *
         * This requires the firmware to send a real component list/map. If it doesn't,
         * everything except `esp32` will correctly show NOT_WORKING.
         */
        foreach ($defaultComponents as $componentName) {
            $status = $statusMap[$componentName] ?? 'not_working';
            if ($componentName === 'esp32') {
                // Keep the computed ESP32 status (warning/working/etc.) from the payload rules above.
                $status = $statusMap['esp32'] ?? $status;
            }

            try {
                MachineHardwareStatus::updateOrCreate(
                    [
                        'microcontroller_id' => $machine->id,
                        'component_name' => $componentName,
                    ],
                    [
                        'status' => $status,
                        'last_checked_at' => now(),
                    ]
                );
            } catch (\Throwable $e) {
                // If DB enum is out of date, don't crash the heartbeat endpoint.
                // Live monitoring via Firebase RTDB should still work.
            }
        }

        // Bump presence only after hardware rows are written so `last_seen` ordering matches
        // `last_checked_at` (avoids UI treating fresh rows as stale).
        $machine->update(['last_seen' => now()]);

        $this->recordSensorLogForActiveSession($machine, $decodedRoot);

        // ESP firmware already PUTs `machines/{id}/hardware_status` every ~2s. A second Laravel
        // mirror here made `updated_at` + components flip and the app looked offline/online.
        // MySQL `last_seen` above is enough for the API; mobile uses RTDB from the board only.

        $resp = [
            'success' => true,
            'microcontroller_id' => $machine->id,
            'device_id' => $machine->device_id,
            'mac' => $this->microcontrollersHasMacColumn() ? $machine->mac : null,
            'display_name' => $machine->display_name,
            'name' => $this->machineDisplayName($machine),
            'detected_components' => array_keys($statusMap),
            'received_component_count' => count($statusMap),
            'assumed_all_components' => false,
            'missing_components' => array_values(array_diff($defaultComponents, array_keys($statusMap))),
        ];

        if ($debugEnabled) {
            $resp['debug'] = $debug;
        }

        return response()->json($resp);
    }

    private function isMicrocontrollerOnline(Microcontroller $machine): bool
    {
        $raw = $machine->getAttributes()['last_seen'] ?? null;
        if ($raw === null || $raw === '') {
            return false;
        }
        $ls = $raw instanceof Carbon ? $raw : Carbon::parse($raw);

        return $ls->gte(now()->subMinutes(self::ONLINE_LAST_SEEN_MINUTES));
    }

    /**
     * True when Firebase RTDB `machines/{id}/hardware_status` was updated recently
     * (ESP may reach RTDB while Laravel HTTP heartbeat is blocked or misconfigured).
     */
    private function isMicrocontrollerOnlineViaFirebase(int $microcontrollerId): bool
    {
        if ($microcontrollerId <= 0) {
            return false;
        }

        try {
            $firebase = app(FirebaseRealtimeService::class);
            if (! $firebase->isEnabled()) {
                return false;
            }

            $snap = $firebase->getMachineHardwareStatus($microcontrollerId);
            if (! is_array($snap)) {
                return false;
            }

            $updated = $snap['updated_at'] ?? null;
            if ($updated === null || $updated === '') {
                return false;
            }

            if (is_array($updated)) {
                return false;
            }

            if (is_numeric($updated)) {
                $ms = (int) $updated;
                if ($ms > 0 && $ms < 1_000_000_000_000) {
                    $ms *= 1000;
                }

                return Carbon::createFromTimestampMs($ms)
                    ->gte(now()->subSeconds(self::ONLINE_RTDB_GRACE_SECONDS));
            }

            return Carbon::parse((string) $updated)
                ->gte(now()->subSeconds(self::ONLINE_RTDB_GRACE_SECONDS));
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Online for session control / overview — MySQL `last_seen` OR fresh Firebase heartbeat.
     */
    private function isMicrocontrollerReachable(Microcontroller $machine): bool
    {
        if ($this->isMicrocontrollerOnline($machine)) {
            return true;
        }

        if (! $this->isMicrocontrollerOnlineViaFirebase((int) $machine->id)) {
            return false;
        }

        // Heal Laravel presence when RTDB proves the board is live (e.g. SEND_TO_LARAVEL blocked).
        try {
            $machine->update(['last_seen' => now()]);
        } catch (\Throwable) {
            // Non-fatal — session can still start.
        }

        return true;
    }

    private function componentAliases(string $componentName): array
    {
        $key = strtolower(str_replace([' ', '-'], '_', urldecode($componentName)));

        return match ($key) {
            'esp32' => ['esp32'],
            'buzzer' => ['buzzer'],
            'door_sensor' => ['door_sensor', 'door', 'mc38', 'reed_switch', 'reed', 'magnetic_switch'],
            'heater_1' => ['heater_1', 'heater1', 'relay_1', 'relay1'],
            'heater_2' => ['heater_2', 'heater2', 'relay_2', 'relay2'],
            'fan_1' => ['fan_1', 'fan1', 'heater_fan_1'],
            'fan_2' => ['fan_2', 'fan2', 'heater_fan_2'],
            'fan_3' => ['fan_3', 'fan3', 'ventilation_fan', 'exhaust_fan', 'fan'],
            'dht22' => ['dht22', 'temp_humidity_sensor', 'dht11', 'dht'],
            'led_1' => ['led_1', 'led_drying'],
            'led_2' => ['led_2', 'led_pause'],
            'led_3' => ['led_3', 'led_stop'],
            'moisture_sensor' => [
                'moisture_sensor',
                'moisture',
                'yl69',
                'yl_69',
                'soil_moisture',
            ],
            default => [$key],
        };
    }

    public function index(Request $request)
    {
        $range = $request->query('range', '3months');
        $now = now();
        $startDate = match ($range) {
            'weekly' => $now->copy()->subDays(7),
            'monthly' => $now->copy()->subMonth(),
            default => $now->copy()->subMonths(3),
        };

        $machineFilter = $request->query('microcontroller_id', $request->query('machine_id'));

        $sessions = DryingSession::query()
            ->when($machineFilter !== null && $machineFilter !== '', function ($query) use ($machineFilter) {
                $query->where('microcontroller_id', (int) $machineFilter);
            })
            ->whereIn('status', ['completed', 'stopped'])
            ->where(function ($query) use ($startDate) {
                $query->whereNotNull('ended_at')->where('ended_at', '>=', $startDate)
                    ->orWhere(function ($sub) use ($startDate) {
                        $sub->whereNull('ended_at')->where('created_at', '>=', $startDate);
                    });
            })
            ->with(['sensorLogs:id,drying_session_id,temperature,humidity,moisture,fan_speed,recorded_at'])
            ->latest('ended_at')
            ->latest('id')
            ->get();

        $rows = $sessions->map(function (DryingSession $session) {
            return $this->transformSessionForHistory($session);
        })->values();

        return response()->json([
            'range' => $range,
            'sessions' => $rows,
            'summary' => [
                'total_batches' => $rows->count(),
                'avg_duration_minutes' => round((float) $rows->avg('duration_minutes'), 2),
                'avg_temperature' => round((float) $rows->avg('avg_temperature'), 2),
                'avg_humidity' => round((float) $rows->avg('avg_humidity'), 2),
                'avg_moisture' => round((float) $rows->avg('avg_moisture'), 2),
            ],
        ]);
    }

    public function show(int $id)
    {
        $session = DryingSession::with(['sensorLogs:id,drying_session_id,temperature,humidity,moisture,fan_speed,recorded_at'])
            ->findOrFail($id);

        return response()->json([
            'data' => $this->transformSessionForHistory($session),
        ]);
    }

    public function destroy(int $id)
    {
        $session = DryingSession::findOrFail($id);
        $session->delete();

        return response()->json([
            'success' => true,
            'message' => 'Drying session deleted successfully.',
        ]);
    }

    public function destroyBatch(Request $request)
    {
        $data = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|exists:drying_sessions,id',
        ]);

        DryingSession::whereIn('id', $data['ids'])->delete();

        return response()->json([
            'success' => true,
            'message' => 'Selected drying sessions deleted.',
        ]);
    }

    /**
     * Start / pause / stop drying session from mobile control panel.
     */
    public function sessionControl(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'microcontroller_id' => 'required|integer|exists:microcontrollers,id',
            'action' => 'required|string|in:start,pause,stop',
            'fish_type' => 'nullable|string|max:255',
            'total_fish' => 'nullable|integer|min:0',
            'target_temperature' => 'nullable|numeric',
            'fan_speed' => 'nullable|integer|min:1|max:3',
            'set_duration_minutes' => 'nullable|integer|min:1',
            'drying_time_minutes' => 'nullable|integer|min:0',
            'drying_time_seconds' => 'nullable|integer|min:0',
            'temperature' => 'nullable|numeric',
            'humidity' => 'nullable|numeric',
            'moisture' => 'nullable|numeric',
        ]);

        $mcId = (int) $data['microcontroller_id'];
        $userId = (int) $data['user_id'];
        $action = $data['action'];

        $machine = Microcontroller::find($mcId);
        if ($machine instanceof Microcontroller && $this->isMicrocontrollerReachable($machine)) {
            // Keep DB presence in sync when RTDB is live (UI uses Firebase for Online).
            try {
                $machine->update(['last_seen' => now()]);
            } catch (\Throwable) {
                // Non-fatal.
            }
        }

        try {
            if ($action === 'start') {
                foreach (['fish_type', 'total_fish', 'target_temperature', 'fan_speed', 'set_duration_minutes'] as $field) {
                    if (! array_key_exists($field, $data) || $data[$field] === null || $data[$field] === '') {
                        return response()->json([
                            'success' => false,
                            'message' => ucfirst(str_replace('_', ' ', $field)).' is required to start drying.',
                        ], 422);
                    }
                }

                $blocking = DryingSession::where('microcontroller_id', $mcId)
                    ->whereIn('status', ['running', 'paused'])
                    ->whereNull('ended_at')
                    ->exists();

                if ($blocking) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Pause or stop the active session before starting a new one.',
                    ], 422);
                }

                $session = DryingSession::create([
                    'session_code' => 'mob-'.Str::uuid()->toString(),
                    'microcontroller_id' => $mcId,
                    'user_id' => $userId,
                    'fish_type' => $data['fish_type'],
                    'total_fish' => (int) $data['total_fish'],
                    'target_temperature' => (float) $data['target_temperature'],
                    'fan_speed' => (int) $data['fan_speed'],
                    'set_duration_minutes' => (int) $data['set_duration_minutes'],
                    'drying_time_minutes' => 0,
                    'status' => 'running',
                    'started_at' => now(),
                    'ended_at' => null,
                ]);

                $this->syncEspSessionToFirebase(
                    $mcId,
                    'running',
                    (float) $data['target_temperature'],
                    (int) $data['fan_speed']
                );

                return response()->json([
                    'success' => true,
                    'session' => $session,
                    'firebase_command' => 'start',
                ]);
            }

            if ($action === 'pause') {
                $paused = DryingSession::where('microcontroller_id', $mcId)
                    ->where('status', 'paused')
                    ->whereNull('ended_at')
                    ->latest('started_at')
                    ->first();

                if ($paused) {
                    $update = ['status' => 'running'];
                    foreach (['fish_type', 'total_fish', 'target_temperature', 'fan_speed', 'set_duration_minutes', 'drying_time_minutes'] as $field) {
                        if (array_key_exists($field, $data) && $data[$field] !== null && $data[$field] !== '') {
                            $update[$field] = in_array($field, ['total_fish', 'fan_speed', 'set_duration_minutes', 'drying_time_minutes'], true)
                                ? (int) $data[$field]
                                : ($field === 'target_temperature' ? (float) $data[$field] : $data[$field]);
                        }
                    }
                    if (array_key_exists('drying_time_seconds', $data) && $data['drying_time_seconds'] !== null) {
                        $update['drying_time_minutes'] = max(0, (int) $data['drying_time_seconds']);
                    }
                    $paused->update($update);
                    $paused = $paused->fresh();
                    $this->syncEspSessionToFirebase(
                        $mcId,
                        (string) $paused->status,
                        (float) $paused->target_temperature,
                        (int) $paused->fan_speed
                    );

                    return response()->json([
                        'success' => true,
                        'session' => $paused,
                        'firebase_command' => 'start',
                    ]);
                }

                $session = DryingSession::where('microcontroller_id', $mcId)
                    ->where('status', 'running')
                    ->whereNull('ended_at')
                    ->latest('started_at')
                    ->first();

                if (! $session) {
                    return response()->json([
                        'success' => false,
                        'message' => 'No running session to pause.',
                    ], 422);
                }

                $update = ['status' => 'paused'];
                foreach (['fish_type', 'total_fish', 'target_temperature', 'fan_speed', 'set_duration_minutes', 'drying_time_minutes'] as $field) {
                    if (array_key_exists($field, $data) && $data[$field] !== null && $data[$field] !== '') {
                        $update[$field] = in_array($field, ['total_fish', 'fan_speed', 'set_duration_minutes', 'drying_time_minutes'], true)
                            ? (int) $data[$field]
                            : ($field === 'target_temperature' ? (float) $data[$field] : $data[$field]);
                    }
                }
                if (array_key_exists('drying_time_seconds', $data) && $data['drying_time_seconds'] !== null) {
                    $update['drying_time_minutes'] = max(0, (int) $data['drying_time_seconds']);
                }
                $session->update($update);
                $session = $session->fresh();
                $this->syncEspSessionToFirebase(
                    $mcId,
                    (string) $session->status,
                    (float) $session->target_temperature,
                    (int) $session->fan_speed
                );

                return response()->json([
                    'success' => true,
                    'session' => $session,
                    'firebase_command' => 'pause',
                ]);
            }

            if ($action === 'stop') {
                $session = DryingSession::where('microcontroller_id', $mcId)
                    ->whereIn('status', ['running', 'paused'])
                    ->whereNull('ended_at')
                    ->latest('started_at')
                    ->first();

                if (! $session) {
                    return response()->json([
                        'success' => false,
                        'message' => 'No active session to stop.',
                    ], 422);
                }

                $elapsedSeconds = $this->resolveElapsedDryingSecondsForStop($session, $data);

                $update = [
                    'status' => 'stopped',
                    'ended_at' => now(),
                    // Column name is legacy; value = actual running seconds (pause excluded).
                    'drying_time_minutes' => $elapsedSeconds,
                ];
                foreach (['fish_type', 'total_fish', 'target_temperature', 'fan_speed', 'set_duration_minutes'] as $field) {
                    if (array_key_exists($field, $data) && $data[$field] !== null && $data[$field] !== '') {
                        $update[$field] = in_array($field, ['total_fish', 'fan_speed', 'set_duration_minutes', 'drying_time_minutes'], true)
                            ? (int) $data[$field]
                            : ($field === 'target_temperature' ? (float) $data[$field] : $data[$field]);
                    }
                }
                $session->update($update);

                $this->appendFinalSensorLogFromRequest($session, $data);

                $this->syncEspSessionToFirebase($mcId, 'stopped', 0, 1);

                return response()->json([
                    'success' => true,
                    'session' => $session->fresh()->load('sensorLogs'),
                    'firebase_command' => 'stop',
                ]);
            }
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }

        return response()->json(['success' => false, 'message' => 'Unknown action'], 400);
    }

    /**
     * Mobile / admin: read ESP telemetry straight from Firebase (same node the board writes).
     */
    public function firebaseTelemetry(Request $request, int $machineId)
    {
        $machine = Microcontroller::find($machineId);
        if (! $machine) {
            return response()->json(['success' => false, 'message' => 'Machine not found'], 404);
        }

        $firebase = app(FirebaseRealtimeService::class);
        if (! $firebase->isEnabled()) {
            return response()->json([
                'success' => false,
                'message' => 'Firebase RTDB is disabled. Set FIREBASE_ENABLED=true in Laravel .env',
            ], 503);
        }

        $hardware = $firebase->getMachineHardwareStatus($machineId);
        $session = $firebase->getMachineSession($machineId);

        return response()->json([
            'success' => true,
            'machine_id' => $machineId,
            'online' => $this->isMicrocontrollerOnlineViaFirebase($machineId),
            'hardware_status' => $hardware,
            'live_readings' => is_array($hardware) ? ($hardware['readings'] ?? null) : null,
            'session' => $session,
        ]);
    }

    public function recommendation(Request $request)
    {
        $mcId = (int) $request->query('microcontroller_id', 0);

        $currentSession = DryingSession::query()
            ->whereIn('status', ['running', 'paused'])
            ->whereNull('ended_at')
            ->when($mcId > 0, fn ($q) => $q->where('microcontroller_id', $mcId))
            ->latest('started_at')
            ->first();

        $inputFishType = trim((string) $request->query('fish_type', ''));
        $inputTemperature = $request->query('temperature');
        $inputHumidity = $request->query('humidity');
        $inputMoisture = $request->query('moisture');
        $inputFanSpeed = $request->query('fan_speed');
        $inputElapsedMinutes = $request->query('elapsed_minutes');

        $activeFishType = $inputFishType !== ''
            ? $inputFishType
            : trim((string) ($currentSession?->fish_type ?? ''));

        if ($activeFishType === '') {
            return response()->json([
                'success' => false,
                'message' => 'No recommendation available.',
            ], 422);
        }

        $hasInputVector = $inputTemperature !== null || $inputHumidity !== null || $inputMoisture !== null || $inputFanSpeed !== null;

        if (!$currentSession && !$hasInputVector) {
            return response()->json([
                'success' => false,
                'message' => 'No active session or input data available for recommendation.',
            ], 404);
        }

        $currentLog = $currentSession?->sensorLogs()->latest('recorded_at')->first();
        if (!$currentLog && !$hasInputVector) {
            return response()->json([
                'success' => false,
                'message' => 'No sensor readings available for the active session.',
            ], 404);
        }

        $candidatesQuery = DryingSession::query()
            ->whereIn('status', ['stopped', 'completed'])
            ->whereNotNull('ended_at')
            ->with(['sensorLogs:id,drying_session_id,temperature,humidity,moisture,fan_speed,recorded_at']);

        if ($currentSession) {
            $candidatesQuery->where('id', '!=', $currentSession->id);
        }
        if ($mcId > 0) {
            $candidatesQuery->where('microcontroller_id', $mcId);
        }

        $candidates = $candidatesQuery
            ->get()
            ->filter(fn (DryingSession $session) => $session->sensorLogs->isNotEmpty())
            ->map(function (DryingSession $session) {
                $logs = $session->sensorLogs;
                return [
                    'session' => $session,
                    'avg_temperature' => (float) ($logs->avg('temperature') ?? 0),
                    'avg_humidity' => (float) ($logs->avg('humidity') ?? 0),
                    'avg_moisture' => (float) ($logs->avg('moisture') ?? 0),
                    'avg_fan_speed' => (float) ($logs->avg('fan_speed') ?? ($session->fan_speed ?? 0)),
                    'duration_minutes' => (float) ($session->drying_time_minutes ?? $session->set_duration_minutes ?? 0),
                ];
            })
            ->values();

        if ($candidates->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'Not enough past drying data yet. Complete more sessions to get suggestions.',
            ], 404);
        }

        $fishCandidates = $candidates
            ->filter(fn (array $c) => $this->fishTypesMatch($c['session']->fish_type ?? '', $activeFishType))
            ->values();

        if ($fishCandidates->isEmpty()) {
            $displayFish = $this->displayFishTypeLabel($activeFishType);

            return response()->json([
                'success' => false,
                'message' => "No drying history is available for {$displayFish}.",
                'fish_type' => $activeFishType,
            ], 404);
        }

        $currentVector = [
            (float) ($inputTemperature ?? $currentLog?->temperature ?? $currentSession?->target_temperature ?? 0),
            (float) ($inputHumidity ?? $currentLog?->humidity ?? 0),
            (float) ($inputMoisture ?? $currentLog?->moisture ?? 0),
            (float) ($inputFanSpeed ?? $currentLog?->fan_speed ?? $currentSession?->fan_speed ?? 0),
        ];

        // Same fish type only; prefer fully dried sessions when available.
        $successful = $fishCandidates
            ->filter(fn (array $c) => ($c['session']->final_status ?? null) === 'fully_dried')
            ->values();
        $pool = $successful->isNotEmpty() ? $successful : $fishCandidates;

        // Normalize features so distance isn't dominated by units (°C vs % vs fan level).
        $mins = [
            't' => (float) $pool->min('avg_temperature'),
            'h' => (float) $pool->min('avg_humidity'),
            'm' => (float) $pool->min('avg_moisture'),
            'f' => (float) $pool->min('avg_fan_speed'),
        ];
        $maxs = [
            't' => (float) $pool->max('avg_temperature'),
            'h' => (float) $pool->max('avg_humidity'),
            'm' => (float) $pool->max('avg_moisture'),
            'f' => (float) $pool->max('avg_fan_speed'),
        ];
        $norm = function (float $x, float $min, float $max): float {
            $range = $max - $min;
            if ($range <= 0.000001) return 0.0;
            return ($x - $min) / $range;
        };

        $currentNorm = [
            $norm($currentVector[0], $mins['t'], $maxs['t']),
            $norm($currentVector[1], $mins['h'], $maxs['h']),
            $norm($currentVector[2], $mins['m'], $maxs['m']),
            $norm($currentVector[3], $mins['f'], $maxs['f']),
        ];

        $nearest = $pool
            ->map(function (array $candidate) use ($currentNorm, $norm, $mins, $maxs) {
                $candNorm = [
                    $norm((float) $candidate['avg_temperature'], $mins['t'], $maxs['t']),
                    $norm((float) $candidate['avg_humidity'], $mins['h'], $maxs['h']),
                    $norm((float) $candidate['avg_moisture'], $mins['m'], $maxs['m']),
                    $norm((float) $candidate['avg_fan_speed'], $mins['f'], $maxs['f']),
                ];

                $candidate['distance'] = sqrt(
                    (($candNorm[0] - $currentNorm[0]) ** 2) +
                    (($candNorm[1] - $currentNorm[1]) ** 2) +
                    (($candNorm[2] - $currentNorm[2]) ** 2) +
                    (($candNorm[3] - $currentNorm[3]) ** 2)
                );

                return $candidate;
            })
            ->sortBy('distance')
            ->take(3)
            ->values();

        $recommendedTemperature = round((float) $nearest->avg('avg_temperature'), 1);
        $recommendedFanSpeed = (int) max(1, min(3, round((float) $nearest->avg('avg_fan_speed'))));
        $recommendedDuration = (int) max(1, round((float) $nearest->avg('duration_minutes')));
        $elapsedMinutes = (int) (
            $inputElapsedMinutes !== null && $inputElapsedMinutes !== ''
                ? $inputElapsedMinutes
                : ($currentSession?->drying_time_minutes ?? 0)
        );
        $targetDuration = (int) ($currentSession?->set_duration_minutes ?? 0);
        $needsExtension = $currentSession
            && $targetDuration > 0
            && $elapsedMinutes >= $targetDuration;
        $extensionMinutes = $needsExtension ? (int) max(5, $recommendedDuration) : 0;

        return response()->json([
            'success' => true,
            'needs_extension' => $needsExtension,
            'recommendation' => [
                'temperature' => $recommendedTemperature,
                'fan_speed' => $recommendedFanSpeed,
                'duration_minutes' => $recommendedDuration,
                'extension_minutes' => $extensionMinutes,
                'description' => $needsExtension
                    ? "Drying time is up. Suggested extension: {$extensionMinutes} minute(s) with the settings below."
                    : (
                        $successful->isNotEmpty()
                            ? 'Suggested temperature, fan speed, and drying time based on similar successful dries.'
                            : 'Suggested settings based on your previous drying sessions.'
                    ),
            ],
        ]);
    }

    private function normalizeFishTypeKey(?string $value): string
    {
        $v = strtolower(trim((string) $value));
        $v = preg_replace('/\s+/', ' ', $v) ?? '';

        return $v;
    }

    private function fishTypesMatch(?string $a, ?string $b): bool
    {
        $ka = $this->normalizeFishTypeKey($a);
        $kb = $this->normalizeFishTypeKey($b);
        if ($ka === '' || $kb === '') {
            return false;
        }

        return $ka === $kb;
    }

    private function displayFishTypeLabel(string $value): string
    {
        $v = trim($value);

        return $v !== '' ? '"'.$v.'"' : 'this fish type';
    }

    private function formatDryingTimeLabel(int $minutes): string
    {
        $minutes = max(0, $minutes);
        if ($minutes < 60) {
            return $minutes.' min';
        }
        $hours = intdiv($minutes, 60);
        $mins = $minutes % 60;

        return $mins > 0 ? "{$hours} hr {$mins} min" : "{$hours} hr";
    }

    /**
     * Actual run time while drying (pause excluded). Only trust the mobile timer — never wall clock.
     */
    private function resolveElapsedDryingSecondsForStop(DryingSession $session, array $data): int
    {
        if (array_key_exists('drying_time_seconds', $data) && $data['drying_time_seconds'] !== null) {
            return max(0, (int) $data['drying_time_seconds']);
        }

        if (array_key_exists('drying_time_minutes', $data) && $data['drying_time_minutes'] !== null) {
            return max(0, (int) $data['drying_time_minutes']) * 60;
        }

        return max(0, (int) ($session->drying_time_minutes ?? 0));
    }

    private function appendFinalSensorLogFromRequest(DryingSession $session, array $data): void
    {
        $hasReading = array_key_exists('temperature', $data)
            || array_key_exists('humidity', $data)
            || array_key_exists('moisture', $data);
        if (! $hasReading) {
            return;
        }

        $last = $session->sensorLogs()->latest('recorded_at')->first();

        try {
            SensorLog::create([
                'drying_session_id' => $session->id,
                'temperature' => (float) (
                    $data['temperature'] ?? $last?->temperature ?? $session->target_temperature ?? 0
                ),
                'humidity' => (float) ($data['humidity'] ?? $last?->humidity ?? 0),
                'moisture' => (float) ($data['moisture'] ?? $last?->moisture ?? 0),
                'fan_speed' => (int) ($session->fan_speed ?? $last?->fan_speed ?? 1),
                'recorded_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('sensor_log_final_failed', ['message' => $e->getMessage()]);
        }
    }

    private function recordSensorLogForActiveSession(Microcontroller $machine, array $decodedRoot): void
    {
        $session = DryingSession::where('microcontroller_id', $machine->id)
            ->whereIn('status', ['running', 'paused'])
            ->whereNull('ended_at')
            ->latest('started_at')
            ->first();

        if (! $session) {
            return;
        }

        $readings = $decodedRoot['readings'] ?? null;
        if (! is_array($readings) || $readings === []) {
            try {
                $firebase = app(FirebaseRealtimeService::class);
                if ($firebase->isEnabled()) {
                    $snap = $firebase->getMachineHardwareStatus((int) $machine->id);
                    $readings = is_array($snap['readings'] ?? null) ? $snap['readings'] : null;
                }
            } catch (\Throwable) {
                return;
            }
        }

        if (! is_array($readings) || $readings === []) {
            return;
        }

        $last = $session->sensorLogs()->latest('recorded_at')->first();
        if ($last?->recorded_at && Carbon::parse($last->recorded_at)->gte(now()->subSeconds(25))) {
            return;
        }

        $temp = isset($readings['temperature']) ? (float) $readings['temperature'] : null;
        $humidity = isset($readings['humidity']) ? (float) $readings['humidity'] : null;
        $moisture = isset($readings['moisture_percent'])
            ? (float) $readings['moisture_percent']
            : (isset($readings['moisture']) ? (float) $readings['moisture'] : null);

        if ($temp === null && $humidity === null && $moisture === null) {
            return;
        }

        try {
            SensorLog::create([
                'drying_session_id' => $session->id,
                'temperature' => $temp ?? (float) ($session->target_temperature ?? 0),
                'humidity' => $humidity ?? 0,
                'moisture' => $moisture ?? 0,
                'fan_speed' => (int) ($session->fan_speed ?? 1),
                'recorded_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('sensor_log_insert_failed', ['message' => $e->getMessage()]);
        }
    }

    private function transformSessionForHistory(DryingSession $session): array
    {
        $logs = $session->sensorLogs;
        $lastLog = $logs->last();

        /** `drying_time_minutes` column stores running seconds (pause excluded). */
        $totalDryingSeconds = max(0, (int) ($session->drying_time_minutes ?? 0));
        $totalDryingMinutes = (int) floor($totalDryingSeconds / 60);

        $avgHumidity = $logs->isNotEmpty() ? round((float) $logs->avg('humidity'), 2) : null;
        $avgMoisture = $logs->isNotEmpty() ? round((float) $logs->avg('moisture'), 2) : null;
        $avgTemperature = $logs->isNotEmpty() ? round((float) $logs->avg('temperature'), 2) : null;

        return [
            'id' => $session->id,
            'microcontroller_id' => $session->microcontroller_id,
            'session_code' => $session->session_code,
            'date' => optional($session->ended_at ?? $session->created_at)->toDateTimeString(),
            'fish_type' => $session->fish_type ?? 'Unknown',
            'total_fish' => $session->total_fish !== null ? (int) $session->total_fish : null,
            'target_temperature' => $session->target_temperature !== null ? (float) $session->target_temperature : null,
            'status' => $session->status,
            'duration_minutes' => (int) $totalDryingMinutes,
            'set_duration_minutes' => $session->set_duration_minutes !== null ? (int) $session->set_duration_minutes : null,
            'drying_time_minutes' => (int) $totalDryingMinutes,
            'drying_time_seconds' => (int) $totalDryingSeconds,
            'temperature' => $lastLog?->temperature !== null ? (float) $lastLog->temperature : null,
            'humidity' => $lastLog?->humidity !== null ? (float) $lastLog->humidity : $avgHumidity,
            'moisture' => $lastLog?->moisture !== null ? (float) $lastLog->moisture : $avgMoisture,
            'fan_speed' => $lastLog?->fan_speed ?? $session->fan_speed,
            'avg_temperature' => $avgTemperature,
            'avg_humidity' => $avgHumidity,
            'avg_moisture' => $avgMoisture,
            'avg_fan_speed' => $logs->isNotEmpty()
                ? round((float) ($logs->avg('fan_speed') ?? ($session->fan_speed ?? 0)), 2)
                : null,
            'started_at' => optional($session->started_at)->toDateTimeString(),
            'ended_at' => optional($session->ended_at)->toDateTimeString(),
        ];
    }

    public function overview(Request $request)
    {
        $machine = null;
        $requestedId = $request->query('machine_id');
        if ($requestedId !== null && $requestedId !== '') {
            $machine = Microcontroller::find((int) $requestedId);
        }

        if (!$machine) {
            $candidates = Microcontroller::query()
                ->orderByDesc('last_seen')
                ->orderByDesc('id')
                ->get();

            $machine = $candidates->first(fn (Microcontroller $m) => $this->isMicrocontrollerReachable($m))
                ?? $candidates->first();
        }

        if (!$machine) {
            return response()->json([
                'machine' => null,
                'session' => null,
                'hardware_statuses' => [],
                'message' => 'No machine configured yet'
            ]);
        }

        // Only expose an *active* drying session on overview so Status matches Control Panel.
        // (Previously `latest()` could return a finished session while a new run was starting,
        // or show stale fish/duration after Stop — Current Details should be empty when idle.)
        $session = DryingSession::where('microcontroller_id', $machine->id)
            ->whereIn('status', ['running', 'paused'])
            ->whereNull('ended_at')
            ->with(['sensorLogs:id,drying_session_id,temperature,humidity,moisture,fan_speed,recorded_at'])
            ->orderByDesc('started_at')
            ->orderByDesc('id')
            ->first();

        $hardwareStatuses = MachineHardwareStatus::where('microcontroller_id', $machine->id)->get();

        $liveReadings = null;
        $rtdbHardware = null;
        $rtdbSession = null;
        $firebaseEnabled = false;

        // Laravel reads live sensor data from Firebase (ESP writes hardware_status).
        try {
            $firebase = app(FirebaseRealtimeService::class);
            $firebaseEnabled = $firebase->isEnabled();
            if ($firebaseEnabled) {
                $rtdbHardware = $firebase->getMachineHardwareStatus((int) $machine->id);
                $rtdbSession = $firebase->getMachineSession((int) $machine->id);
                $readings = is_array($rtdbHardware) ? ($rtdbHardware['readings'] ?? null) : null;
                if (is_array($readings) && $readings !== []) {
                    $liveReadings = $readings;
                }
                $components = is_array($rtdbHardware) ? ($rtdbHardware['components'] ?? null) : null;
                if (is_array($components) && $components !== []) {
                    $rows = [];
                    foreach ($this->firebaseSensorHardwareComponentKeys() as $key) {
                        $rows[] = [
                            'component_name' => $key,
                            'status' => (string) ($components[$key] ?? 'not_working'),
                        ];
                    }
                    $hardwareStatuses = collect($rows);
                }
            }
        } catch (\Throwable $e) {
            // Never break overview when Firebase is unavailable.
        }

        $lastSeen = $machine->last_seen;
        $online = $this->isMicrocontrollerReachable($machine)
            || ($firebaseEnabled && $this->isMicrocontrollerOnlineViaFirebase((int) $machine->id));

        return response()->json([
            'machine' => [
                'id' => $machine->id,
                'name' => $this->machineDisplayName($machine),
                'device_id' => $machine->device_id,
                'mac' => $this->microcontrollersHasMacColumn() ? $machine->mac : null,
                'display_name' => $machine->display_name,
                'last_seen' => $lastSeen ? $lastSeen->toIso8601String() : null,
                'status' => $online ? 'online' : 'offline',
            ],
            'session' => $session,
            'hardware_statuses' => $hardwareStatuses,
            'live_readings' => $liveReadings,
            'rtdb' => [
                'enabled' => $firebaseEnabled,
                'hardware_updated_at' => is_array($rtdbHardware) ? ($rtdbHardware['updated_at'] ?? null) : null,
                'session' => $rtdbSession,
            ],
            'message' => null,
        ]);
    }


    public function analyzeBatch(Request $request)
    {
        try {

            $image = $request->input('image');

            if (!$image) {
                return response()->json([
                    'success' => false,
                    'message' => 'No image received'
                ], 400);
            }

            $response = Http::post('http://127.0.0.1:8001/api/ai/analyze', [
                'image' => $image,
                'drying_time_minutes' => $request->input('drying_time_minutes', 0)
            ]);


            if (!$response->successful()) {
                return response()->json([
                    'success' => false,
                    'message' => 'AI server error',
                    'response' => $response->body()
                ], 500);
            }

            $data = $response->json();

            return response()->json([
                'annotated_image' => $data['annotated_image'] ?? null,

                'fish_species' => $data['fish_species'] ?? '--',
                'fish_counts' => $data['fish_counts'] ?? 0,

                'appearance_display' => $data['appearance_display'] ?? '--',
                'color_display' => $data['color_display'] ?? '--',
                'texture_display' => $data['texture_display'] ?? '--',

                'fully_dried' => $data['fully_dried'] ?? 0,
                'partially_dried' => $data['partially_dried'] ?? 0,
                'not_dried' => $data['not_dried'] ?? 0,

                // ✅ FIXED STRUCTURE
                'recommended_temperature' => $data['recommendation']['temperature'] ?? null,
                'recommended_fan_speed' => $data['recommendation']['fan_speed'] ?? null,
                'suggested_additional_hours' => $data['recommendation']['time'] ?? null,
                'recommendation_text' => $data['recommendation']['description'] ?? null,
            ]);

        } catch (\Exception $e) {

            return response()->json([
                'success' => false,
                'message' => 'AI detection failed',
                'error' => $e->getMessage()
            ], 500);

        }
    }

    public function applyRecommendation($captureId)
    {
        try {
            $capture = \App\Models\CaptureSession::findOrFail($captureId);

            $batch = $capture->dryingBatch;
            $session = $batch->dryingSession;

            // ❗ VALIDATION (important)
            if (
                !$capture->recommended_temperature ||
                !$capture->recommended_fan_speed ||
                !$capture->suggested_additional_hours
            ) {
                return response()->json([
                    'success' => false,
                    'message' => 'No valid recommendation available'
                ], 400);
            }

            // Convert hours → minutes
            $duration = $capture->suggested_additional_hours * 60;

            // Update drying session (CONTROL PANEL AUTO-FILL)
            $session->update([
                'target_temperature' => $capture->recommended_temperature,
                'fan_speed' => $capture->recommended_fan_speed,
                'set_duration_minutes' => $duration,
                'recommendation_applied' => true
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Recommendation applied successfully',
                'data' => [
                    'temperature' => $capture->recommended_temperature,
                    'fan_speed' => $capture->recommended_fan_speed,
                    'duration' => $duration
                ]
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to apply recommendation',
                'error' => $e->getMessage()
            ], 500);
        }
    }


    public function getMachines()
    {
        try {
            $cols = ['id', 'device_id', 'display_name', 'last_seen'];
            if ($this->microcontrollersHasMacColumn()) {
                $cols[] = 'mac';
            }
            $machines = Microcontroller::query()
                ->select($cols)
                ->latest('last_seen')
                ->get();

            $data = $machines->map(function (Microcontroller $machine) {
                $lastSeen = $machine->last_seen;

                return [
                    'id' => $machine->id,
                    'name' => $this->machineDisplayName($machine),
                    'device_id' => $machine->device_id,
                    'mac' => $this->microcontrollersHasMacColumn() ? $machine->mac : null,
                    'display_name' => $machine->display_name,
                    'last_seen' => $lastSeen ? $lastSeen->toIso8601String() : null,
                    'status' => $this->isMicrocontrollerReachable($machine)
                        ? 'online'
                        : 'offline',
                ];
            })->values();

            return response()->json([
                'success' => true,
                'data' => $data->values()->all(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching machines'
            ], 500);
        }
    }

    /**
     * Get components for selected machine - ALWAYS VISIBLE with status based on machine
     */
    public function getComponents($machineId)
    {
        try {
            $machine = Microcontroller::find($machineId);

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            // Always return full hardware list expected by the mobile UI.
            // NOTE: DHT22 is one sensor (temp+humidity outputs), and moisture sensor is single.
            $defaultComponents = [
                'esp32',
                'led_1',
                'led_2',
                'led_3',
                'buzzer',
                'door_sensor',
                'moisture_sensor',
                'heater_1',
                'heater_2',
                'fan_1',
                'fan_2',
                'fan_3',
                'dht22',
            ];

            $savedRows = MachineHardwareStatus::where('microcontroller_id', $machineId)->get();

            $resolveRow = function (string $componentName) use ($savedRows): ?MachineHardwareStatus {
                $aliases = $this->componentAliases($componentName);
                $best = null;
                foreach ($savedRows as $row) {
                    $rowKey = (string) $row->component_name;
                    if (! in_array($rowKey, $aliases, true)) {
                        continue;
                    }
                    if ($best === null) {
                        $best = $row;

                        continue;
                    }
                    $a = $row->last_checked_at;
                    $b = $best->last_checked_at;
                    if ($a && $b && $a->gt($b)) {
                        $best = $row;
                    } elseif ($a && ! $b) {
                        $best = $row;
                    }
                }

                return $best;
            };

            $isOnline = $this->isMicrocontrollerOnline($machine);

            if ($savedRows->isEmpty()) {
                $components = collect($defaultComponents)->map(function (string $componentName) use ($isOnline) {
                    $status = $componentName === 'esp32'
                        ? ($isOnline ? 'warning' : 'not_working')
                        : 'not_working';

                    return [
                        'component_name' => $componentName,
                        'status' => $status,
                    ];
                });
            } else {
                $components = collect($defaultComponents)->map(function (string $componentName) use ($resolveRow, $isOnline) {
                    $found = $resolveRow($componentName);
                    $stored = $found?->status;

                    if ($isOnline) {
                        if ($componentName === 'esp32') {
                            $known = $found
                                && $found->last_checked_at
                                && in_array((string) $stored, ['working', 'warning', 'not_working'], true);

                            // ESP32 row should reflect stored diagnostics (warning/working/etc.),
                            // not blindly become "working" just because Wi‑Fi is up.
                            $status = $known ? (string) $stored : 'warning';
                        } else {
                            $known = $found
                                && $found->last_checked_at
                                && in_array((string) $stored, ['working', 'warning', 'not_working'], true);

                            $status = $known ? (string) $stored : 'not_working';
                        }
                    } else {
                        if ($componentName === 'esp32') {
                            $status = 'not_working';
                        } elseif ($found && $found->last_checked_at && in_array((string) $stored, ['working', 'warning', 'not_working'], true)) {
                            $status = (string) $stored;
                        } else {
                            $status = 'not_working';
                        }
                    }

                    return [
                        'component_name' => $componentName,
                        'status' => $status,
                    ];
                });
            }

            return response()->json([
                'success' => true,
                // Force JSON array (never keyed object) so React Native always gets [].
                'data' => $components->values()->all(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching components'
            ], 500);
        }
    }

    /**
     * Add new machine
     */
    public function addMachine(Request $request)
    {
        try {
            $deviceIdRules = ['nullable', 'string', 'max:255'];
            $deviceIdRules[] = $request->filled('selected_id')
                ? Rule::unique('microcontrollers', 'device_id')->ignore((int) $request->input('selected_id'))
                : Rule::unique('microcontrollers', 'device_id');

            $request->validate([
                // Friendly label (separate from hardware device_id)
                'name' => 'nullable|string|max:255',
                // Hardware identity sent by ESP32 heartbeats (ignore own row on rename/save)
                'device_id' => $deviceIdRules,
                'mac' => ['nullable', 'string', 'max:32'],
                'selected_id' => 'nullable|integer|exists:microcontrollers,id',
            ]);

            $creatorId = (int) (Auth::id() ?? 0);
            if ($creatorId <= 0) {
                $creatorId = (int) (DB::table('users')->orderBy('id')->value('id') ?? 0);
            }
            if ($creatorId <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot add a machine: sign in or ensure at least one user exists in the database (the add-machine API is not authenticated).',
                ], 422);
            }

            $macNorm = $this->normalizeHardwareMac($request->input('mac'));
            if ($macNorm && $this->microcontrollersHasMacColumn()) {
                $dup = Microcontroller::query()->where('mac', $macNorm);
                if ($request->filled('selected_id')) {
                    $dup->where('id', '!=', (int) $request->input('selected_id'));
                }
                if ($dup->exists()) {
                    return response()->json([
                        'success' => false,
                        'message' => 'This MAC is already linked to another machine row.',
                    ], 422);
                }
            }

            if ($request->filled('selected_id')) {
                $candidate = Microcontroller::find((int) $request->input('selected_id'));
                $candidateMac = $candidate
                    ? $this->normalizeHardwareMac($candidate->mac ?? null)
                    : null;
                // Only update an existing row when this physical MAC already owns that id.
                $updateExisting = $candidate
                    && (
                        ($macNorm && $candidateMac && $macNorm === $candidateMac)
                        || (! $macNorm && $candidateMac === null)
                    );
            } else {
                $updateExisting = false;
            }

            if ($updateExisting) {
                $machine = Microcontroller::findOrFail((int) $request->selected_id);
                // Never mutate hardware identity from the mobile "name" field.
                $updates = [
                    'display_name' => $request->input('name'),
                ];
                if ($macNorm && $this->microcontrollersHasMacColumn()) {
                    $updates['mac'] = $macNorm;
                }
                $machine->update($updates);
            } else {
                if (!$request->filled('device_id')) {
                    return response()->json([
                        'success' => false,
                        'message' => 'device_id is required when creating a new microcontroller record.',
                    ], 422);
                }

                $create = [
                    'device_id' => (string) $request->device_id,
                    'display_name' => $request->input('name'),
                    'created_by' => $creatorId,
                    // Presence/online is determined by ESP heartbeats, not manual adds.
                    'last_seen' => null,
                ];
                if ($macNorm && $this->microcontrollersHasMacColumn()) {
                    $create['mac'] = $macNorm;
                }
                $machine = Microcontroller::create($create);
            }

            try {
                $firebase = app(FirebaseRealtimeService::class);
                if ($firebase->isEnabled() && $macNorm) {
                    $firebase->setDeviceAssignment($macNorm, [
                        'microcontroller_id' => (int) $machine->id,
                        'name' => $this->machineDisplayName($machine),
                        'device_id' => (string) $machine->device_id,
                        'mac' => implode(':', str_split($macNorm, 2)),
                        'updated_at' => now()->toIso8601String(),
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('addMachine_firebase_assignment_failed', [
                    'microcontroller_id' => $machine->id,
                    'message' => $e->getMessage(),
                ]);
            }

            return response()->json([
                'success' => true,
                'message' => 'Microcontroller added successfully',
                'data' => [
                    'id' => $machine->id,
                    'name' => $this->machineDisplayName($machine),
                    'device_id' => $machine->device_id,
                    'mac' => $this->microcontrollersHasMacColumn() ? $machine->mac : null,
                    'display_name' => $machine->display_name,
                    'last_seen' => $machine->last_seen ? $machine->last_seen->toIso8601String() : null,
                    'status' => $this->isMicrocontrollerOnline($machine) ? 'online' : 'offline',
                ]
            ], 201);
        } catch (\Exception $e) {
            Log::error('addMachine failed', ['exception' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Error adding machine',
                'error' => config('app.debug') ? $e->getMessage() : null,
            ], 500);
        }
    }

    /**
     * Test specific component - ONLY WORKS IF MACHINE IS ONLINE
     */
    public function testComponent(Request $request, $machineId, $componentName)
    {
        try {
            $machine = Microcontroller::find($machineId);

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            $isOnline = $this->isMicrocontrollerOnline($machine);

            $aliases = $this->componentAliases($componentName);
            $component = MachineHardwareStatus::where('microcontroller_id', $machineId)
                ->whereIn('component_name', $aliases)
                ->first();

            if (!$component) {
                return response()->json([
                    'success' => false,
                    'message' => 'Component not found'
                ], 404);
            }

            // Deterministic status: never randomize.
            // ESP32 status follows connectivity; others keep last known hardware status.
            $primaryAlias = $aliases[0] ?? '';
            if ($primaryAlias === 'esp32') {
                $newStatus = $isOnline ? 'working' : 'not_working';
            } else {
                $newStatus = in_array($component->status, ['working', 'warning', 'not_working'], true)
                    ? $component->status
                    : 'warning';
            }

            $component->update([
                'status' => $newStatus,
                'last_checked_at' => now(),
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Component tested successfully',
                'data' => [
                    'component_name' => $componentName,
                    'status' => $newStatus
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error testing component'
            ], 500);
        }
    }

    /**
     * Test all components - ONLY WORKS IF MACHINE IS ONLINE
     */
    public function testAllComponents(Request $request, $machineId)
    {
        try {
            $machine = Microcontroller::find($machineId);

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            $isOnline = $this->isMicrocontrollerOnline($machine);

            $components = MachineHardwareStatus::where('microcontroller_id', $machineId)->get();
            
            foreach ($components as $component) {
                $newStatus = $component->component_name === 'esp32'
                    ? ($isOnline ? 'working' : 'not_working')
                    : (in_array($component->status, ['working', 'warning', 'not_working'], true)
                        ? $component->status
                        : 'warning');

                $component->update([
                    'status' => $newStatus,
                    'last_checked_at' => now(),
                ]);
            }

            $updatedComponents = MachineHardwareStatus::where('microcontroller_id', $machineId)->get()
                ->map(fn($comp) => [
                    'component_name' => $comp->component_name,
                    'status' => $comp->status
                ]);

            return response()->json([
                'success' => true,
                'message' => 'All components tested successfully',
                'data' => $updatedComponents
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error testing components'
            ], 500);
        }
    }

    /**
     * Detect available microcontrollers
     */
    public function detectMicrocontrollers()
    {
        try {
            // List ALL boards so the app can always show something to pick.
            // `recent` / `status` reflect the same heartbeat window as getMachines().
            $cols = ['id', 'device_id', 'display_name', 'last_seen'];
            if ($this->microcontrollersHasMacColumn()) {
                $cols[] = 'mac';
            }
            $activeESP = DB::table('microcontrollers')
                ->select($cols)
                ->orderByDesc('last_seen')
                ->get()
                ->map(function ($item) {
                    $display = trim((string) ($item->display_name ?? ''));
                    $label = $display !== '' ? $display : (string) $item->device_id;
                    $lastSeen = $item->last_seen ? Carbon::parse($item->last_seen) : null;
                    $recent = (bool) ($lastSeen && $lastSeen->gte(now()->subMinutes(self::ONLINE_LAST_SEEN_MINUTES)));

                    return [
                        'id' => (string) $item->id,
                        'name' => $label,
                        'device_id' => $item->device_id,
                        'mac' => $this->microcontrollersHasMacColumn() ? ($item->mac ?? null) : null,
                        'display_name' => $item->display_name,
                        'last_seen' => $item->last_seen,
                        'recent' => $recent,
                        'status' => $recent ? 'online' : 'offline',
                        'selected' => false,
                    ];
                });

            return response()->json([
                'success' => true,
                'data' => $activeESP->values()->all(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error detecting microcontrollers',
                'data' => [] // Return empty array on error
            ], 500);
        }
    }

    public function notificationsIndex(Request $request)
    {
        $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'microcontroller_id' => 'nullable|integer|exists:microcontrollers,id',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);

        $userId = (int) $request->query('user_id');
        $perPage = (int) ($request->query('per_page', 15));

        $query = Notification::query()
            ->where(function ($sub) use ($userId) {
                $sub->where('user_id', $userId)->orWhereNull('user_id');
            })
            ->orderByDesc('created_at');

        if ($request->filled('microcontroller_id')) {
            $query->where('microcontroller_id', (int) $request->query('microcontroller_id'));
        }

        return response()->json($query->paginate($perPage));
    }

    public function notificationsMarkRead(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|exists:notifications,id',
            'is_read' => 'nullable|boolean',
        ]);

        $read = array_key_exists('is_read', $data) ? (bool) $data['is_read'] : true;

        Notification::whereIn('id', $data['ids'])
            ->where(function ($q) use ($data) {
                $q->where('user_id', $data['user_id'])->orWhereNull('user_id');
            })
            ->update(['is_read' => $read]);

        return response()->json(['success' => true]);
    }

    public function notificationsDestroyBatch(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer|exists:notifications,id',
        ]);

        Notification::whereIn('id', $data['ids'])
            ->where(function ($q) use ($data) {
                $q->where('user_id', $data['user_id'])->orWhereNull('user_id');
            })
            ->delete();

        return response()->json(['success' => true]);
    }

    public function deleteMachine($machineId)
    {
        try {
            $machine = Microcontroller::find($machineId);
            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }
            $machine->delete();
            return response()->json([
                'success' => true,
                'message' => 'Microcontroller deleted successfully',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting machine'
            ], 500);
        }
    }
}