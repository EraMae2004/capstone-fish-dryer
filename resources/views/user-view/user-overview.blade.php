@extends('user-view.user-view')

@section('content')
@vite(['resources/css/user-view/user-overview.css'])
<div class="overview-wrapper">

    <!-- HEADER -->
    <div class="overview-header">
        <div>
            <h2>OVERVIEW</h2>

            <div class="machine-status-line">
                <span class="status-label">Machine Status:</span>

                @php $status = $batch->status ?? null; @endphp

                <span class="status-dot
                    {{ $status === 'running' ? 'dot-green'
                    : ($status === 'stopped' ? 'dot-red'
                    : 'dot-gray') }}">
                </span>

                <span class="status-text">
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

            <div class="header-buttons">
                <button class="btn btn-start">Start</button>
                <button class="btn btn-pause">Pause</button>
                <button class="btn btn-stop">Stop</button>
            </div>

        </div>
    </div>


    <!-- MAIN GRID -->
    <div class="overview-grid">

        <!-- LEFT COLUMN -->
        <div class="left-section">

            <!-- CURRENT DETAILS -->
            <div class="info-card">
                <div class="card-header">Current Details</div>

                <div class="info-row">
                    <span>Type of Fish</span>
                    <strong>{{ $batch->fish_type ?? '--' }}</strong>
                </div>

                <div class="info-row">
                    <span>No. of Fish</span>
                    <strong>{{ $batch->quantity ?? '--' }} {{ $batch->quantity_unit ?? '' }}</strong>
                </div>

                <div class="info-row">
                    <span>Current Temp</span>
                    <strong>{{ $batch->final_temperature ?? '--' }}°C</strong>
                </div>

                <div class="info-row">
                    <span>Target Temp</span>
                    <strong>{{ $batch->target_temperature ?? '--' }}°C</strong>
                </div>

                <div class="info-row">
                    <span>Humidity</span>
                    <strong>{{ $batch->final_humidity ?? '--' }}%</strong>
                </div>

                <div class="info-row">
                    <span>Current Moisture</span>
                    <strong>{{ $batch->final_moisture ?? '--' }}%</strong>
                </div>

                <div class="info-row">
                    <span>Target Moisture</span>
                    <strong>{{ $batch->target_moisture ?? '--' }}%</strong>
                </div>

                <div class="info-row">
                    <span>Fan Speed</span>
                    <strong>Level {{ $batch->fan_speed ?? '--' }}</strong>
                </div>

                <div class="info-row last-row">
                    <span>Remaining Time</span>
                    <strong>{{ $remainingTime ?? '--:--:--' }}</strong>
                </div>
            </div>


            <!-- CONTROL PANEL -->
            <div class="info-card control-panel-card">
                <div class="card-header">Control Panel</div>

                <form method="POST" action="#">
                    @csrf

                    <div class="control-grid">

                        <div class="control-row">
                            <label for="fish_type">Fish Species</label>
                            <input type="text"
                                id="fish_type"
                                name="fish_type"
                                value="{{ $batch->fish_type ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="quantity">No. of Fish</label>
                            <input type="number"
                                id="quantity"
                                name="quantity"
                                value="{{ $batch->quantity ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="target_moisture">Target Moisture (%)</label>
                            <input type="number"
                                step="0.01"
                                id="target_moisture"
                                name="target_moisture"
                                value="{{ $batch->target_moisture ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="target_humidity">Set Humidity (%)</label>
                            <input type="number"
                                step="0.01"
                                id="target_humidity"
                                name="target_humidity"
                                value="{{ $batch->target_humidity ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="target_temperature">Set Temperature (°C)</label>
                            <input type="number"
                                step="0.01"
                                id="target_temperature"
                                name="target_temperature"
                                value="{{ $batch->target_temperature ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="fan_speed">Fan Speed</label>
                            <input type="number"
                                min="1"
                                max="5"
                                id="fan_speed"
                                name="fan_speed"
                                value="{{ $batch->fan_speed ?? '' }}">
                        </div>

                        <div class="control-row">
                            <label for="duration">Duration (minutes)</label>
                            <input type="number"
                                id="duration"
                                name="planned_duration_minutes"
                                value="{{ $batch->planned_duration_minutes ?? '' }}">
                        </div>

                        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
                            <button type="submit" class="btn btn-start">
                                Save Settings
                            </button>
                        </div>

                    </div>
                </form>
            </div>



        </div>


        <!-- RIGHT COLUMN -->
        <div class="right-section">

            <!-- HARDWARE STATUS -->
            <div class="info-card">
                <div class="card-header">Hardware Status</div>

                @php
                    $components = [
                        'esp32','lcd','fan','buzzer','led',
                        'temp_humidity_sensor','moisture_sensor'
                    ];
                @endphp

                @foreach($components as $component)

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
                            {{ $hwStatus ? ucfirst(str_replace('_',' ',$hwStatus)) : '--' }}
                        </span>
                    </div>

                @endforeach

            </div>


            <<!-- FISH STATUS -->
            <div class="info-card fish-status-card">

                <div class="fish-header">
                    <div class="card-header">Fish Status</div>
                    <button class="capture-btn">📷 Capture Tray</button>
                </div>

                <div class="fish-layout">

                    <!-- IMAGE COLUMN -->
                    <div class="fish-images">

                        <div class="image-box">
                            Front Image
                        </div>

                        <div class="image-box">
                            Back Image
                        </div>

                    </div>

                    <!-- TEXT COLUMN -->
                    <div class="fish-details">

                        <div class="fish-row">
                            <span>Appearance:</span>
                            <strong>{{ $latestCapture->appearance ?? '--' }}</strong>
                        </div>

                        <div class="fish-row">
                            <span>Color:</span>
                            <strong>{{ $latestCapture->color ?? '--' }}</strong>
                        </div>

                        <div class="fish-row">
                            <span>Texture:</span>
                            <strong>{{ $latestCapture->texture ?? '--' }}</strong>
                        </div>

                        <div class="fish-row">
                            <span>Description:</span>
                            <strong>{{ $latestCapture->description ?? '--' }}</strong>
                        </div>

                        <div class="fish-row">
                            <span>Recommendations:</span>
                            <strong>{{ $latestCapture->recommendations ?? '--' }}</strong>
                        </div>

                    </div>

                </div>

            </div>


        </div>

    </div>

</div>

@endsection
