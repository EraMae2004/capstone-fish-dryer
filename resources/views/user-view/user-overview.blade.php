@extends('user-view.user-view')

@section('content')
@vite(['resources/css/user-view/user-overview.css'])

<div class="overview-wrapper">

    <!-- ================= HEADER ================= -->
    <div class="overview-header">

        <div>
            <h2>OVERVIEW</h2>

            <div class="machine-status-line">
                <span>Machine Status:</span>

                @php $status = $batch->status ?? null; @endphp

                <span class="status-dot
                    {{ $status === 'running' ? 'dot-green'
                    : ($status === 'stopped' ? 'dot-red'
                    : 'dot-gray') }}">
                </span>

                <span>
                    {{ $status === 'running' ? 'Drying'
                       : ($status === 'stopped' ? 'Stopped'
                       : 'Idle') }}
                </span>
            </div>
        </div>

        <div class="header-controls">
            <select class="machine-dropdown">
                <option>{{ $machine->name ?? 'No Machine' }}</option>
            </select>
        </div>

    </div>

    <!-- ================= MAIN GRID ================= -->
    <div class="overview-grid">

        <!-- LEFT SECTION -->
        <div class="left-section">

            <!-- CURRENT DETAILS -->
            <div class="info-card">
                <div class="card-header">Current Details</div>

                @foreach([
                    ['Type of Fish', $batch->fish_type ?? '--'],
                    ['No. of Fish', ($batch ? $batch->quantity.' '.$batch->quantity_unit : '--')],
                    ['Current Temp', ($batch->final_temperature ?? '--').'°C'],
                    ['Target Temp', ($batch->target_temperature ?? '--').'°C'],
                    ['Humidity', ($batch->final_humidity ?? '--').'%'],
                    ['Current Moisture', ($batch->final_moisture ?? '--').'%'],
                    ['Target Moisture', ($batch->target_moisture ?? '--').'%'],
                    ['Fan Speed', 'Level '.($batch->fan_speed ?? '--')],
                    ['Remaining Time', $remainingTime ?? '--:--:--']
                ] as $row)

                    <div class="info-row">
                        <span>{{ $row[0] }}</span>
                        <strong>{{ $row[1] }}</strong>
                    </div>

                @endforeach
            </div>

            <!-- CONTROL PANEL -->
            <div class="info-card control-panel-card">
                <div class="card-header">Control Panel</div>

                <form>

                    <div class="control-grid">

                        <div class="control-row">
                            <label>Fish Species</label>
                            <input type="text" value="{{ $batch->fish_type ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>No. of Fish</label>
                            <input type="number" value="{{ $batch->quantity ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>Target Moisture (%)</label>
                            <input type="number" value="{{ $batch->target_moisture ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>Set Humidity (%)</label>
                            <input type="number" value="{{ $batch->target_humidity ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>Set Temperature (°C)</label>
                            <input type="number" value="{{ $batch->target_temperature ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>Fan Speed</label>
                            <input type="number" value="{{ $batch->fan_speed ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label>Duration (minutes)</label>
                            <input type="number" value="{{ $batch->planned_duration_minutes ?? '' }}">
                        </div>

                    </div>

                    <!-- START PAUSE STOP -->
                    <div class="control-actions">

                        <button type="button" class="btn btn-start">
                            <i class="fa fa-play"></i> Start
                        </button>

                        <button type="button" class="btn btn-pause">
                            <i class="fa fa-pause"></i> Pause
                        </button>

                        <button type="button" class="btn btn-stop">
                            <i class="fa fa-stop"></i> Stop
                        </button>

                    </div>

                </form>
            </div>
        </div>


        <!-- RIGHT SECTION -->
        <div class="right-section">

            <!-- HARDWARE STATUS -->
            <div class="info-card">
                <div class="card-header">Hardware Status</div>

                @foreach(['esp32','lcd','fan','buzzer','led','temp_humidity_sensor','moisture_sensor'] as $component)

                    @php
                        $item = $hardwareStatuses->firstWhere('component_name',$component);
                        $hwStatus = $item->status ?? null;
                    @endphp

                    <div class="hardware-row">
                        <span>{{ strtoupper(str_replace('_',' ',$component)) }}</span>

                        <span class="hardware-badge
                            {{ $hwStatus === 'working' ? 'badge-green'
                             : ($hwStatus === 'not_working' ? 'badge-red'
                             : 'badge-gray') }}">
                            {{ $hwStatus ? ucfirst($hwStatus) : '--' }}
                        </span>
                    </div>

                @endforeach
            </div>

            <!-- FISH STATUS -->
            <div class="info-card fish-status-card">

                <div class="fish-header">
                    <div class="card-header">Fish Status</div>
                    <button class="capture-button">
                        <i class="fa fa-camera"></i> Capture Tray
                    </button>
                </div>

                <div class="fish-layout">

                    <div class="fish-images">
                        <div class="image-box">Front Image</div>
                        <div class="image-box">Back Image</div>
                    </div>

                    <div class="fish-details">
                        @foreach([
                            ['Appearance', $latestCapture->appearance ?? '--'],
                            ['Color', $latestCapture->color ?? '--'],
                            ['Texture', $latestCapture->texture ?? '--'],
                            ['Description', $latestCapture->description ?? '--'],
                            ['Recommendations', $latestCapture->recommendations ?? '--'],
                        ] as $item)

                        <div class="fish-row">
                            <span>{{ $item[0] }}:</span>
                            <strong>{{ $item[1] }}</strong>
                        </div>

                        @endforeach
                    </div>

                </div>

            </div>

        </div>

    </div>

</div>

@endsection
