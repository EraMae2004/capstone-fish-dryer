<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use App\Models\Machine;
use App\Models\DryingSession;
use App\Models\MachineHardwareStatus;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;


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
                'duration' => $data['duration'] ?? '--',

                'appearance' => $data['appearance'] ?? '--',
                'color_text' => $data['color_text'] ?? '--',
                'texture_text' => $data['texture_text'] ?? '--',

                'fully_dried' => $data['fully_dried'] ?? 0,
                'partially_dried' => $data['partially_dried'] ?? 0,
                'not_dried' => $data['not_dried'] ?? 0,

                'recommendation' => $data['recommendation'] ?? [
                    'description' => 'No recommendation available.'
                ]

            ]);

        } catch (\Exception $e) {

            return response()->json([
                'success' => false,
                'message' => 'AI detection failed',
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