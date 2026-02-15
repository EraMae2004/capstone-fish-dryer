<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use App\Models\Machine;
use App\Models\DryingBatch;
use App\Models\CaptureSession;
use App\Models\MachineHardwareStatus;
use Illuminate\Support\Facades\Auth;

class DryingController extends Controller
{
    public function overview()
    {
        $machine = Machine::where('status', 'online')->first();

        $batch = null;
        $hardwareStatuses = collect();
        $latestCapture = null;
        $remainingTime = null;

        if ($machine) {

            $batch = DryingBatch::where('machine_id', $machine->id)
                ->where('status', 'running')
                ->latest()
                ->first();

            $hardwareStatuses = MachineHardwareStatus::where('machine_id', $machine->id)->get();

            if ($batch) {

                $latestCapture = CaptureSession::where('drying_batch_id', $batch->id)
                    ->latest('captured_at')
                    ->first();

                if ($batch->started_at && $batch->planned_duration_minutes) {

                    $endTime = Carbon::parse($batch->started_at)
                        ->addMinutes($batch->planned_duration_minutes);

                    $seconds = now()->diffInSeconds($endTime, false);

                    if ($seconds > 0) {
                        $remainingTime = gmdate("H:i:s", $seconds);
                    } else {
                        $remainingTime = "00:00:00";
                    }
                }
            }
        }

        return view('user-view.user-overview', [
            'machine' => $machine,
            'batch' => $batch,
            'hardwareStatuses' => $hardwareStatuses,
            'latestCapture' => $latestCapture,
            'remainingTime' => $remainingTime
        ]);
    }

    public function history()
    {
        // Get completed drying sessions of logged in user
        $histories = DryingBatch::where('user_id', Auth::id())
            ->whereIn('status', ['completed', 'extended'])
            ->latest()
            ->get();

        // Compute summary stats

        $avgDuration = $histories->avg('actual_duration_minutes');

        $avgMoisture = $histories->avg('final_moisture');

        // Convert duration minutes to hours
        $avgDurationHours = $avgDuration
            ? round($avgDuration / 60, 1)
            : 0;

        return view('user-view.user-history', [
            'histories'      => $histories,
            'avgDuration'    => $avgDurationHours,
            'avgMoisture'    => round($avgMoisture ?? 0, 1),
        ]);
    }

    public function hardware()
    {
        $machines = Machine::where('created_by', Auth::id())->get();

        $selectedMachine = $machines->first();

        // Default component list (ALWAYS VISIBLE)
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

            // Merge DB statuses into default list
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
