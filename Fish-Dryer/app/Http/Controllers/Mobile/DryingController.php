<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Carbon;
use App\Models\Machine;
use App\Models\DryingSession;
use App\Models\MachineHardwareStatus;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;


class DryingController extends Controller
{
    public function index(Request $request)
    {
        $range = $request->query('range', '3months');
        $now = now();
        $startDate = match ($range) {
            'weekly' => $now->copy()->subDays(7),
            'monthly' => $now->copy()->subMonth(),
            default => $now->copy()->subMonths(3),
        };

        $sessions = DryingSession::query()
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

    public function recommendation()
    {
        $currentSession = DryingSession::query()
            ->whereIn('status', ['running', 'paused'])
            ->latest('started_at')
            ->first();

        if (!$currentSession) {
            return response()->json([
                'success' => false,
                'message' => 'No active session available for recommendation.',
            ], 404);
        }

        $currentLog = $currentSession->sensorLogs()->latest('recorded_at')->first();
        if (!$currentLog) {
            return response()->json([
                'success' => false,
                'message' => 'No sensor readings available for the active session.',
            ], 404);
        }

        $candidates = DryingSession::query()
            ->where('id', '!=', $currentSession->id)
            ->where('status', 'completed')
            ->where('final_status', 'fully_dried')
            ->with(['sensorLogs:id,drying_session_id,temperature,humidity,moisture,fan_speed,recorded_at'])
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
                'message' => 'Not enough successful history for KNN recommendation.',
            ], 404);
        }

        $currentVector = [
            (float) $currentLog->temperature,
            (float) $currentLog->humidity,
            (float) $currentLog->moisture,
            (float) ($currentLog->fan_speed ?? $currentSession->fan_speed ?? 0),
        ];

        // Prefer "successful" sessions, but fall back to any completed sessions if needed.
        $successful = $candidates->filter(fn (array $c) => ($c['session']->final_status ?? null) === 'fully_dried')->values();
        $pool = $successful->isNotEmpty() ? $successful : $candidates;

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
            ->map(function (array $candidate) use ($currentNorm, $currentSession, $norm, $mins, $maxs) {
                $fishPenalty = (
                    !empty($candidate['session']->fish_type) &&
                    !empty($currentSession->fish_type) &&
                    strcasecmp($candidate['session']->fish_type, $currentSession->fish_type) !== 0
                ) ? 5 : 0;

                $candNorm = [
                    $norm((float) $candidate['avg_temperature'], $mins['t'], $maxs['t']),
                    $norm((float) $candidate['avg_humidity'], $mins['h'], $maxs['h']),
                    $norm((float) $candidate['avg_moisture'], $mins['m'], $maxs['m']),
                    $norm((float) $candidate['avg_fan_speed'], $mins['f'], $maxs['f']),
                ];

                // Euclidean distance in normalized sensor-feature space (KNN).
                $distance = sqrt(
                    (($candNorm[0] - $currentNorm[0]) ** 2) +
                    (($candNorm[1] - $currentNorm[1]) ** 2) +
                    (($candNorm[2] - $currentNorm[2]) ** 2) +
                    (($candNorm[3] - $currentNorm[3]) ** 2)
                ) + $fishPenalty;

                $candidate['distance'] = $distance;
                return $candidate;
            })
            ->sortBy('distance')
            ->take(3)
            ->values();

        $recommendedTemperature = round((float) $nearest->avg('avg_temperature'), 1);
        $recommendedFanSpeed = (int) max(1, min(5, round((float) $nearest->avg('avg_fan_speed'))));
        $recommendedDuration = (int) max(1, round((float) $nearest->avg('duration_minutes')));

        return response()->json([
            'success' => true,
            'algorithm' => 'KNN',
            'k' => $nearest->count(),
            'recommendation' => [
                'temperature' => $recommendedTemperature,
                'fan_speed' => $recommendedFanSpeed,
                'duration_minutes' => $recommendedDuration,
                'description' => $successful->isNotEmpty()
                    ? 'Recommended from the nearest successful drying sessions using sensor-based KNN similarity.'
                    : 'Recommended from the nearest past drying sessions using sensor-based KNN similarity (no labeled successful sessions yet).',
            ],
        ]);
    }

    private function transformSessionForHistory(DryingSession $session): array
    {
        $logs = $session->sensorLogs;
        $lastLog = $logs->last();

        $duration = $session->drying_time_minutes
            ?? $session->set_duration_minutes
            ?? (
                $session->started_at && $session->ended_at
                    ? Carbon::parse($session->ended_at)->diffInMinutes(Carbon::parse($session->started_at))
                    : 0
            );

        return [
            'id' => $session->id,
            'session_code' => $session->session_code,
            'date' => optional($session->ended_at ?? $session->created_at)->toDateTimeString(),
            'fish_type' => $session->fish_type ?? 'Unknown',
            'status' => $session->status,
            'duration_minutes' => (int) ($duration ?? 0),
            'temperature' => $lastLog?->temperature !== null ? (float) $lastLog->temperature : null,
            'humidity' => $lastLog?->humidity !== null ? (float) $lastLog->humidity : null,
            'moisture' => $lastLog?->moisture !== null ? (float) $lastLog->moisture : null,
            'fan_speed' => $lastLog?->fan_speed ?? $session->fan_speed,
            'avg_temperature' => round((float) ($logs->avg('temperature') ?? 0), 2),
            'avg_humidity' => round((float) ($logs->avg('humidity') ?? 0), 2),
            'avg_moisture' => round((float) ($logs->avg('moisture') ?? 0), 2),
            'avg_fan_speed' => round((float) ($logs->avg('fan_speed') ?? ($session->fan_speed ?? 0)), 2),
            'started_at' => optional($session->started_at)->toDateTimeString(),
            'ended_at' => optional($session->ended_at)->toDateTimeString(),
        ];
    }

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
            $machines = Machine::where('created_by', Auth::id())
                ->select('id', 'name', 'status', 'working', 'warning', 'not_working', 'health')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $machines
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
            // Verify machine belongs to user
            $machine = Machine::where('created_by', Auth::id())
                ->where('id', $machineId)
                ->first();

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            // Default components - ALWAYS VISIBLE (same as blade)
            $defaultComponents = [
                ['component_name' => 'ESP32 Controller', 'status' => null],
                ['component_name' => 'LCD Display', 'status' => null],
                ['component_name' => 'Buzzer', 'status' => null],
                ['component_name' => 'Fan', 'status' => null],
                ['component_name' => 'Moisture Sensor', 'status' => null],
                ['component_name' => 'Temperature and Humidity Sensor', 'status' => null],
                ['component_name' => 'LED', 'status' => null],
            ];

            // Get saved status for this machine
            $savedStatus = MachineHardwareStatus::where('machine_id', $machineId)
                ->get()
                ->keyBy('component_name');

            // If machine is online, show saved status, otherwise show default/neutral
            $components = collect($defaultComponents)->map(function ($component) use ($savedStatus, $machine) {
                // Map component names to database format
                $dbName = match($component['component_name']) {
                    'ESP32 Controller' => 'esp32',
                    'LCD Display' => 'lcd',
                    'Buzzer' => 'buzzer',
                    'Fan' => 'fan',
                    'Moisture Sensor' => 'moisture_sensor',
                    'Temperature and Humidity Sensor' => 'temp_humidity_sensor',
                    'LED' => 'led',
                    default => strtolower(str_replace(' ', '_', $component['component_name']))
                };

                if ($machine->status === 'online' && $savedStatus->has($dbName)) {
                    $component['status'] = $savedStatus->get($dbName)->status;
                } else {
                    $component['status'] = 'neutral'; // Not Connected when machine is offline
                }

                return $component;
            });

            return response()->json([
                'success' => true,
                'data' => $components
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
            $request->validate([
                'name' => 'required|string|max:255',
                'microcontrollers' => 'array'
            ]);

            // Create new machine
            $machine = Machine::create([
                'name' => $request->name,
                'created_by' => Auth::id(),
                'status' => 'offline',
                'working' => 0,
                'warning' => 0,
                'not_working' => 0,
                'health' => 100
            ]);

            // Initialize default component status with neutral values
            $defaultComponents = [
                'esp32', 'lcd', 'buzzer', 'fan', 
                'moisture_sensor', 'temp_humidity_sensor', 'led'
            ];

            foreach ($defaultComponents as $component) {
                MachineHardwareStatus::create([
                    'machine_id' => $machine->id,
                    'component_name' => $component,
                    'status' => 'neutral'
                ]);
            }

            return response()->json([
                'success' => true,
                'message' => 'Machine added successfully',
                'data' => $machine
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding machine'
            ], 500);
        }
    }

    /**
     * Test specific component - ONLY WORKS IF MACHINE IS ONLINE
     */
    public function testComponent(Request $request, $machineId, $componentName)
    {
        try {
            // Verify machine belongs to user
            $machine = Machine::where('created_by', Auth::id())
                ->where('id', $machineId)
                ->first();

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            // Check if machine is online
            if ($machine->status !== 'online') {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine is offline. Cannot test components.'
                ], 400);
            }

            // Map display name to database name
            $dbName = match($componentName) {
                'ESP32 Controller' => 'esp32',
                'LCD Display' => 'lcd',
                'Buzzer' => 'buzzer',
                'Fan' => 'fan',
                'Moisture Sensor' => 'moisture_sensor',
                'Temperature and Humidity Sensor' => 'temp_humidity_sensor',
                'LED' => 'led',
                default => strtolower(str_replace(' ', '_', $componentName))
            };

            // Get component
            $component = MachineHardwareStatus::where('machine_id', $machineId)
                ->where('component_name', $dbName)
                ->first();

            if (!$component) {
                return response()->json([
                    'success' => false,
                    'message' => 'Component not found'
                ], 404);
            }

            // Simulate testing - cycle through statuses
            $newStatus = match($component->status) {
                'working' => 'warning',
                'warning' => 'not_working',
                'not_working' => 'working',
                default => 'working'
            };

            $component->update(['status' => $newStatus]);

            // Update machine summary counts
            $this->updateMachineSummary($machineId);

            // Get updated component with display name
            $displayName = match($dbName) {
                'esp32' => 'ESP32 Controller',
                'lcd' => 'LCD Display',
                'buzzer' => 'Buzzer',
                'fan' => 'Fan',
                'moisture_sensor' => 'Moisture Sensor',
                'temp_humidity_sensor' => 'Temperature and Humidity Sensor',
                'led' => 'LED',
                default => $componentName
            };

            return response()->json([
                'success' => true,
                'message' => 'Component tested successfully',
                'data' => [
                    'component_name' => $displayName,
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
            // Verify machine belongs to user
            $machine = Machine::where('created_by', Auth::id())
                ->where('id', $machineId)
                ->first();

            if (!$machine) {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine not found'
                ], 404);
            }

            // Check if machine is online
            if ($machine->status !== 'online') {
                return response()->json([
                    'success' => false,
                    'message' => 'Machine is offline. Cannot test components.'
                ], 400);
            }

            // Test all components
            $components = MachineHardwareStatus::where('machine_id', $machineId)->get();
            
            foreach ($components as $component) {
                // Simulate testing - random status for demo
                $statuses = ['working', 'warning', 'not_working', 'working', 'working'];
                $newStatus = $statuses[array_rand($statuses)];
                $component->update(['status' => $newStatus]);
            }

            // Update machine summary
            $this->updateMachineSummary($machineId);

            // Get updated components with display names
            $updatedComponents = MachineHardwareStatus::where('machine_id', $machineId)->get()
                ->map(function($comp) {
                    $displayName = match($comp->component_name) {
                        'esp32' => 'ESP32 Controller',
                        'lcd' => 'LCD Display',
                        'buzzer' => 'Buzzer',
                        'fan' => 'Fan',
                        'moisture_sensor' => 'Moisture Sensor',
                        'temp_humidity_sensor' => 'Temperature and Humidity Sensor',
                        'led' => 'LED',
                        default => $comp->component_name
                    };
                    return [
                        'component_name' => $displayName,
                        'status' => $comp->status
                    ];
                });

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
            // Get microcontrollers that sent data in last 10 seconds
            $activeESP = DB::table('microcontrollers')
                ->where('last_seen', '>=', now()->subSeconds(10))
                ->select('id', 'device_id as name')
                ->get()
                ->map(function($item) {
                    return [
                        'id' => (string)$item->id,
                        'name' => $item->name,
                        'selected' => false
                    ];
                });

            return response()->json([
                'success' => true,
                'data' => $activeESP
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error detecting microcontrollers',
                'data' => [] // Return empty array on error
            ], 500);
        }
    }

    /**
     * Update machine summary counts based on component status
     */
    private function updateMachineSummary($machineId)
    {
        $components = MachineHardwareStatus::where('machine_id', $machineId)->get();
        
        $working = $components->where('status', 'working')->count();
        $warning = $components->where('status', 'warning')->count();
        $notWorking = $components->where('status', 'not_working')->count();
        
        // Calculate health percentage
        $total = $components->count();
        $health = $total > 0 ? round((($working + ($warning * 0.5)) / $total) * 100) : 100;

        // Determine overall status
        $status = 'online';
        if ($notWorking > 2) {
            $status = 'offline';
        } elseif ($warning > 0 || $notWorking > 0) {
            $status = 'warning';
        }

        Machine::where('id', $machineId)->update([
            'working' => $working,
            'warning' => $warning,
            'not_working' => $notWorking,
            'health' => $health,
            'status' => $status,
            'updated_at' => now()
        ]);
    }
}