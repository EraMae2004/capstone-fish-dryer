<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;

use App\Models\Machine;
use App\Models\DryingSession;
use App\Models\DryingBatch;
use App\Models\CaptureSession;
use App\Models\MachineHardwareStatus;

class DryingController extends Controller
{
    /* =========================================================
       OVERVIEW PAGE
    ========================================================= */
    public function overview()
    {
        $machine = Machine::where('status', 'online')->first();

        $session = null;
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

                // Get latest tray batch
                $latestBatch = $session->dryingBatches()->latest()->first();

                if ($latestBatch) {
                    $latestCapture = CaptureSession::where('drying_batch_id', $latestBatch->id)
                        ->latest('captured_at')
                        ->first();
                }

                // Calculate remaining time
                if ($session->started_at && $session->initial_duration_minutes) {

                    $endTime = Carbon::parse($session->started_at)
                        ->addMinutes($session->initial_duration_minutes + $session->extension_minutes);

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
            'hardwareStatuses' => $hardwareStatuses,
            'latestCapture' => $latestCapture,
            'remainingTime' => $remainingTime
        ]);
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
}
