<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Machine;
use App\Models\DryingSession;
use App\Models\MachineHardwareStatus;

class DryingController extends Controller
{
    public function overview()
    {
        $machine = Machine::first();

        if (!$machine) {
            return response()->json([
                'machine' => null,
                'session' => null,
                'hardware_statuses' => [],
                'message' => 'No machine configured yet'
            ]);
        }

        $session = DryingSession::where('machine_id', $machine->id)
            ->latest()
            ->first();

        $hardwareStatuses = MachineHardwareStatus::where('machine_id', $machine->id)->get();

        return response()->json([
            'machine' => $machine,
            'session' => $session,
            'hardware_statuses' => $hardwareStatuses,
            'message' => null
        ]);
    }
}