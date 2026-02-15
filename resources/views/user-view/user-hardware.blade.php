@extends('user-view.user-view')

@section('content')
@vite(['resources/css/user-view/user-hardware.css'])

<div class="hardware-container">

    <!-- ================= TITLE ================= -->
    <h2 class="hardware-title">Hardware Status</h2>

    <!-- ================= MACHINE SUMMARY CARDS ================= -->
    <div class="machine-summary-row">

        @foreach($machines as $machine)
        <div class="machine-summary-card {{ $machine['status'] }}">
            <div class="machine-summary-header">
                <span class="machine-name">{{ $machine['name'] }}</span>

                <span class="machine-online-status">
                    <span class="online-dot {{ $machine['status'] }}"></span>
                    {{ ucfirst($machine['status']) }}
                </span>
            </div>

            <div class="machine-summary-body">
                <div>Working: <strong>{{ $machine['working'] }}</strong></div>
                <div>Warning Issues: <strong>{{ $machine['warning'] }}</strong></div>
                <div>Not Working: <strong>{{ $machine['notWorking'] }}</strong></div>
                <div>
                    Overall Health:
                    <strong>{{ $machine['health'] }}%</strong>
                    Good
                </div>
            </div>
        </div>
        @endforeach

        <!-- ADD MACHINE -->
        <div class="machine-summary-card add-machine-card">
            <div class="add-icon-circle">+</div>
            <div class="add-machine-title">Add New Machine</div>
            <div class="add-machine-sub">Register a new drying machine</div>
            <button class="add-machine-btn">Add Machine</button>
        </div>

    </div>

    <!-- ================= MACHINE SELECT ================= -->
    <div class="machine-select-wrapper">
        <select class="machine-select-dropdown">
            @foreach($machines as $machine)
                <option>{{ $machine['name'] }}</option>
            @endforeach
        </select>
    </div>

    <!-- ================= COMPONENTS CARD ================= -->
    <div class="components-card">

        <div class="components-card-header">
            <div class="components-title">
                <i class="fa fa-bars"></i>
                <span>Hardware Components Status</span>
            </div>

            <button class="test-all-btn">Test All</button>
        </div>

        <div class="components-list">

            @foreach($components as $component)

                @php
                    $status = $component->status;

                    if ($status === 'working') {
                        $statusClass = 'working';
                        $statusLabel = 'Working';
                    } elseif ($status === 'not_working') {
                        $statusClass = 'not-working';
                        $statusLabel = 'Not Working';
                    } else {
                        $statusClass = 'neutral';
                        $statusLabel = 'Not Connected';
                    }
                @endphp

                <div class="component-row">

                    <!-- Left colored vertical line -->
                    <div class="component-status-line {{ $statusClass }}"></div>

                    <div class="component-main">

                        <div class="component-left">

                            <div class="component-icon-box {{ $statusClass }}">
                                @switch($component->component_name)
                                    @case('esp32') <i class="fa fa-microchip"></i> @break
                                    @case('lcd') <i class="fa fa-tv"></i> @break
                                    @case('buzzer') <i class="fa fa-volume-up"></i> @break
                                    @case('fan') <i class="fa fa-fan"></i> @break
                                    @case('moisture_sensor') <i class="fa fa-tint"></i> @break
                                    @case('temp_humidity_sensor') <i class="fa fa-thermometer-half"></i> @break
                                    @case('led') <i class="fa fa-lightbulb"></i> @break
                                @endswitch
                            </div>

                            <div>
                                <div class="component-name">
                                    {{ strtoupper(str_replace('_',' ',$component->component_name)) }}
                                </div>
                                <div class="component-description">
                                    Hardware component monitoring system
                                </div>
                            </div>

                        </div>

                        <div class="component-right">
                            <span class="status-pill {{ $statusClass }}">
                                {{ $statusLabel }}
                            </span>

                            <button class="play-icon-btn">
                                <i class="fa fa-play"></i>
                            </button>
                        </div>

                    </div>

                </div>

            @endforeach

        </div>

    </div>

</div>

@endsection
