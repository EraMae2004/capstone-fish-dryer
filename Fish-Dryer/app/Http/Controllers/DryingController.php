<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Models\Machine;
use App\Models\DryingSession;
use Illuminate\Support\Facades\Http;
use App\Models\CaptureSession;
use App\Models\MachineHardwareStatus;
use App\Models\Notification;

class DryingController extends Controller
{
    /* =========================================================
       OVERVIEW PAGE
    ========================================================= */
    public function overview()
    {
        $machine = Machine::where('status', 'online')->first();

        $session = null;
        $batch = null;              // ✅ define batch properly
        $hardwareStatuses = collect();
        $latestCapture = null;
        $remainingTime = null;

        if ($machine) {

            // Get running session
            $session = DryingSession::where('machine_id', $machine->id)
                ->where('status', 'running')
                ->latest()
                ->first();

            // Get hardware status
            $hardwareStatuses = MachineHardwareStatus::where('machine_id', $machine->id)->get();

            if ($session) {

                // Get latest drying batch
                $batch = $session->dryingBatches()->latest()->first();

                // Get latest capture
                if ($batch) {
                    $latestCapture = CaptureSession::where('drying_batch_id', $batch->id)
                        ->latest('captured_at')
                        ->first();
                }

                // Calculate remaining time
                if ($session->started_at && $session->initial_duration_minutes) {

                    $endTime = Carbon::parse($session->started_at)
                        ->addMinutes(
                            $session->initial_duration_minutes +
                            ($session->extension_minutes ?? 0)
                        );

                    $seconds = now()->diffInSeconds($endTime, false);

                    $remainingTime = $seconds > 0
                        ? gmdate("H:i:s", $seconds)
                        : "00:00:00";
                }
            }
        }

        return view('user-view.user-overview', [
            'machine' => $machine,
            'session' => $session,
            'batch' => $batch,
            'hardwareStatuses' => $hardwareStatuses,
            'latestCapture' => $latestCapture,
            'remainingTime' => $remainingTime
        ]);
    }


    /* =========================================================
       ESP32 HEARTBEAT API
       - Called by microcontroller to mark itself as online
    ========================================================= */
    public function esp32Heartbeat(Request $request)
    {
        $deviceId = $request->input('device_id', 'esp32-1');
        $userId = (int) ($request->input('created_by') ?? 0);
        if ($userId <= 0) {
            $userId = (int) (DB::table('users')->min('id') ?? 1);
        }

        $micro = DB::table('microcontrollers')->where('device_id', $deviceId)->first();
        if ($micro) {
            DB::table('microcontrollers')
                ->where('id', $micro->id)
                ->update(['last_seen' => now(), 'updated_at' => now()]);
            $microId = (int) $micro->id;
        } else {
            $microId = (int) DB::table('microcontrollers')->insertGetId([
                'device_id' => $deviceId,
                'created_by' => $userId,
                'last_seen' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // Supports two payloads:
        // 1) components: { "heater_1": "working", "buzzer": "not_working" }
        // 2) components: ["heater_1", "buzzer"] => auto-marked as working
        $incoming = $request->input('components', []);
        $componentStatusMap = [];

        if (is_array($incoming)) {
            $isAssoc = array_keys($incoming) !== range(0, count($incoming) - 1);
            if ($isAssoc) {
                foreach ($incoming as $name => $status) {
                    $key = strtolower(str_replace([' ', '-'], '_', (string) $name));
                    $value = strtolower((string) $status);
                    $componentStatusMap[$key] = in_array($value, ['working', 'warning', 'not_working'], true)
                        ? $value
                        : 'working';
                }
            } else {
                foreach ($incoming as $name) {
                    $key = strtolower(str_replace([' ', '-'], '_', (string) $name));
                    $componentStatusMap[$key] = 'working';
                }
            }
        }

        // Keep names compatible with current DB enum values.
        $knownComponents = [
            'esp32',
            'solar_panel',
            'heater_fan_1',
            'heater_fan_2',
            'ventilation_fan',
            'heater_1',
            'heater_2',
            'buzzer',
            'led_drying',
            'led_pause',
            'led_stop',
            'temp_humidity_sensor',
            'moisture_sensor',
        ];

        if (! array_key_exists('esp32', $componentStatusMap)) {
            $componentStatusMap['esp32'] = 'working';
        }

        foreach ($knownComponents as $componentName) {
            $status = $componentStatusMap[$componentName] ?? 'warning';

            $existing = DB::table('machine_hardware_status')
                ->where('microcontroller_id', $microId)
                ->where('component_name', $componentName)
                ->first();

            if ($existing) {
                DB::table('machine_hardware_status')
                    ->where('id', $existing->id)
                    ->update([
                        'status' => $status,
                        'last_checked_at' => now(),
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('machine_hardware_status')->insert([
                    'microcontroller_id' => $microId,
                    'component_name' => $componentName,
                    'status' => $status,
                    'last_checked_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        return response()->json([
            'success' => true,
            'microcontroller_id' => $microId,
            'detected_components' => array_keys($componentStatusMap),
        ]);
    }


    /* =========================================================
    ANALYZE BATCH (FRONT + BACK)
    ========================================================= */
    public function analyzeBatch(Request $request)
    {
        $data=$request->json()->all();

        CaptureSession::create([
            'user_id'=>Auth::id(),
            'appearance'=>$data['description'],
            'color'=>$data['color_index'],
            'texture'=>$data['texture_index'],
            'fully_dried'=>$data['fully_dried'],
            'partially_dried'=>$data['partially_dried'],
            'not_dried'=>$data['not_dried'],
            'total_fish'=>$data['total_fish'],
            'description'=>$data['description'],
            'extend_minutes'=>$data['recommendation']['extend_minutes'],
            'suggested_temperature'=>$data['recommendation']['temperature'],
            'suggested_fan_speed'=>$data['recommendation']['fan_speed'],
            'captured_at'=>now()
        ]);

        return response()->json(["success"=>true]);
    }



    public function detectFish(Request $request)
    {
        $image = $request->file('image');

        $response = Http::attach(
            'image',
            file_get_contents($image->getRealPath()),
            'frame.jpg'
        )->post('http://127.0.0.1:5001/detect');

        return response()->json($response->json());
    }



    /* =========================================================
       HISTORY PAGE
    ========================================================= */
    public function history()
    {
        $histories = DryingSession::where('user_id', Auth::id())
            ->whereIn('status', ['completed', 'extended'])
            ->latest()
            ->get();

        // Average total duration
        $avgDuration = $histories->avg('total_duration_minutes');

        $avgDurationHours = $avgDuration
            ? round($avgDuration / 60, 1)
            : 0;

        return view('user-view.user-history', [
            'histories'   => $histories,
            'avgDuration' => $avgDurationHours,
            'avgMoisture' => 0, // You can compute from capture sessions if needed
        ]);
    }

    /* =========================================================
       HARDWARE PAGE
    ========================================================= */
    public function hardware()
    {
        $machines = Machine::where('created_by', Auth::id())->get();

        $selectedMachine = $machines->first();

        // Default components (always visible)
        $defaultComponents = collect([
            (object)['component_name' => 'esp32', 'status' => null],
            (object)['component_name' => 'lcd', 'status' => null],
            (object)['component_name' => 'buzzer', 'status' => null],
            (object)['component_name' => 'fan', 'status' => null],
            (object)['component_name' => 'moisture_sensor', 'status' => null],
            (object)['component_name' => 'temp_humidity_sensor', 'status' => null],
            (object)['component_name' => 'led', 'status' => null],
        ]);

        $components = $defaultComponents;

        if ($selectedMachine) {
            $saved = MachineHardwareStatus::where('machine_id', $selectedMachine->id)->get();

            $components = $defaultComponents->map(function ($default) use ($saved) {
                $match = $saved->firstWhere('component_name', $default->component_name);
                if ($match) {
                    $default->status = $match->status;
                }
                return $default;
            });
        }

        return view('user-view.user-hardware', [
            'machines' => $machines,
            'selectedMachine' => $selectedMachine,
            'components' => $components
        ]);
    }


    public function detectEsp()
    {
        $activeESP = DB::table('microcontrollers')
            ->where('last_seen', '>=', now()->subSeconds(10))
            ->get(['device_id as id']);

        return response()->json($activeESP);
    }


    public function notifications()
    {
        $userId = Auth::id();

        $notifications = Notification::where('user_id', $userId)
            ->latest()
            ->get();

        // Count summary
        $unreadCount = $notifications->where('is_read', false)->count();
        $criticalCount = $notifications->where('type', 'critical')->count();
        $warningCount = $notifications->where('type', 'warning')->count();
        $infoCount = $notifications->where('type', 'info')->count();

        return view('user-view.user-notifications', compact(
            'notifications',
            'unreadCount',
            'criticalCount',
            'warningCount',
            'infoCount'
        ));
    }
}