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
                            <label>Duration (hh:mm:ss)</label>
                            <input type="text" class="duration-input" value="{{ gmdate('H:i:s', (($batch->planned_duration_minutes ?? 0) * 60)) }}" placeholder="00:00:00">
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

            <!-- ================= RECOMMENDATION ================= -->
            <div class="info-card recommendation-card">
                <div class="card-header">Recommendations</div>

                <div class="recommendation-body">
                    <p><strong>Extend Drying Time:</strong> --</p>
                    <p><strong>Suggested Temperature:</strong> -- °C</p>
                    <p><strong>Suggested Fan Speed:</strong> Level --</p>

                    <button type="button" class="apply-btn">
                        Apply Recommendations
                    </button>
                </div>
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
                    <div class="card-header">
                        <span>Batch Evaluation</span>

                        <button type="button" class="add-batch-btn" id="addBatchBtn">
                            <i class="fa fa-plus"></i> Add Batch
                        </button>
                    </div>
                </div>

                <div class="batch-scroll-wrapper" id="batchScrollWrapper">
                    <!-- Batch 1 (template) -->
                    <div class="batch-item" data-batch-id="1">
                        <div class="batch-card">
                            <div class="batch-card-header">
                                <span class="batch-title">Batch 1</span>
                                <button type="button" class="remove-btn">Remove</button>
                            </div>

                            <div class="batch-actions">
                                <button type="button" class="action-btn capture-tray-btn">
                                    <i class="fa fa-camera"></i> Capture Tray
                                </button>
                                <button type="button" class="action-btn upload-image-btn">
                                    <i class="fa fa-upload"></i> Upload Image
                                </button>
                            </div>

                            <div class="batch-images">
                                <div class="image-frame front-frame">
                                    <span class="placeholder">Front Image</span>
                                </div>
                                <div class="image-frame back-frame">
                                    <span class="placeholder">Back Image</span>
                                </div>
                            </div>

                            <div class="batch-status-title">Status</div>

                            <div class="batch-details">
                                <div class="status-row">
                                    <span>Appearance:</span>
                                    <strong class="appearance">--</strong>
                                </div>
                                <div class="status-row">
                                    <span>Color:</span>
                                    <strong class="color">--</strong>
                                </div>
                                <div class="status-row">
                                    <span>Texture:</span>
                                    <strong class="texture">--</strong>
                                </div>
                                <div class="status-row">
                                    <span>Fully Dried:</span>
                                    <strong class="fully-dried">0</strong>
                                </div>
                                <div class="status-row">
                                    <span>Partially Dried:</span>
                                    <strong class="partially-dried">0</strong>
                                </div>
                                <div class="status-row">
                                    <span>Not Dried:</span>
                                    <strong class="not-dried">0</strong>
                                </div>
                                <div class="status-row full-row">
                                    <span>Description:</span>
                                    <strong class="description">--</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>


        </div>

    </div>

    </div>

 
    <!-- ================= CAMERA / UPLOAD MODAL ================= -->
    <div id="imageProcessModal" class="modal" style="display:none;">
        <div class="modal-box">

            <div class="modal-preview-area">
                <video id="cameraVideo" autoplay playsinline></video>
                <img id="previewImage" style="display:none;" />
                <div id="analyzingBox" class="analyzing-box" style="display:none;">
                    <div class="loader"></div>
                    <span>Analyzing Image......</span>
                </div>
                <div id="flipText" class="flip-text" style="display:none;"></div>
            </div>

            <div class="modal-buttons">
                <button id="takePhotoBtn" class="modal-btn primary">Take Photo</button>
                <button id="savePhotoBtn" class="modal-btn primary" style="display:none;">Save Photo</button>
                <button id="retakePhotoBtn" class="modal-btn secondary" style="display:none;">Retake Photo</button>
                <button id="closeModalBtn" class="modal-btn secondary">Close</button>
            </div>

            <input type="file" id="uploadInput" accept="image/*" style="display:none;" />
            <canvas id="photoCanvas" style="display:none;"></canvas>

        </div>
    </div>

</div>

@endsection
