<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use App\Models\Machine;
use App\Models\DryingBatch;
use App\Models\CaptureSession;
use App\Models\MachineHardwareStatus;

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
}
