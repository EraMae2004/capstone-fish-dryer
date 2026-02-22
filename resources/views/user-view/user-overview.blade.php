@extends('user-view.user-view')

@section('content')
@vite(['resources/css/user-view/user-overview.css', 'resources/js/user-overview.js'])

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


            <!-- ================= BATCH EVALUATION ================= -->
            <div class="info-card batch-evaluation-card">

                <div class="batch-header">
                    <div class="card-header">Batch Evaluation</div>

                    <button type="button" class="add-batch-btn" id="addBatchBtn">
                        <i class="fa fa-plus"></i> Add Batch
                    </button>
                </div>

                <div class="batch-scroll-wrapper" id="batchScrollWrapper">

                    <!-- INITIAL BATCH -->
                    <div class="batch-item">

                        <div class="batch-card">

                            <div class="batch-card-header">
                                <span class="batch-title">Batch 1</span>
                                <button type="button" class="remove-btn">Remove</button>
                            </div>

                            <div class="batch-images">
                                <button type="button" class="capture-btn">Capture Front</button>
                                <button type="button" class="capture-btn">Capture Back</button>

                                <div class="image-frame">
                                    <span>Front Image</span>
                                </div>

                                <div class="image-frame">
                                    <span>Back Image</span>
                                </div>
                            </div>

                            <div class="batch-status-title">Status</div>

                            <div class="batch-details">
                                <div><span>Appearance:</span><strong>--</strong></div>
                                <div><span>Fully Dried:</span><strong>--</strong></div>
                                <div><span>Color:</span><strong>--</strong></div>
                                <div><span>Partially Dried:</span><strong>--</strong></div>
                                <div><span>Texture:</span><strong>--</strong></div>
                                <div><span>Not Dried:</span><strong>--</strong></div>
                                <div class="full-row">
                                    <span>Description:</span>
                                    <strong>--</strong>
                                </div>
                            </div>

                        </div>

                    </div>
                    <!-- END INITIAL BATCH -->

                </div>

            </div>


        </div>

    </div>


    <!-- ================= RECOMMENDATION ================= -->
    <div class="info-card recommendation-card">

        <div class="recommendation-body">

            <div class="recommendation-left">
                <h4>Recommendations</h4>
            </div>

            <div class="recommendation-center">
                <p><strong>Extend Drying Time:</strong> --</p>
                <p><strong>Suggested Temperature:</strong> -- °C</p>
                <p><strong>Suggested Fan Speed:</strong> Level --</p>
            </div>

            <div class="recommendation-right">
                <button type="button" class="apply-btn">
                    Apply Recommendations
                </button>
            </div>

        </div>

    </div>

</div>

@endsection
