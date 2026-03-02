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
