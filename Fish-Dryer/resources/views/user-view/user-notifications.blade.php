@extends('user-view.user-view')

@section('content')

@vite(['resources/css/user-view/user-notifications.css'])

<div class="notifications-wrapper">

    <!-- TITLE -->
    <h2 class="notif-title">Notifications</h2>

    <!-- FILTERS -->
    <div class="notif-top">

        <div class="filters">
            <button class="filter-btn active">All</button>
            <button class="filter-btn unread">Unread</button>
            <button class="filter-btn">Alerts</button>
            <button class="filter-btn">Info</button>
        </div>

        <div class="machine-select">
            <select>
                <option>Drying Machine 1</option>
            </select>
        </div>

    </div>

    <!-- SUMMARY CARDS -->
    <div class="notif-summary">

        <div class="summary-card">
            <div class="summary-icon blue">
                <i class="fa-solid fa-envelope"></i>
            </div>
            <div class="summary-text">
                <span>Unread Notifications</span>
                <h3>{{ $unreadCount ?? 2 }}</h3>
                <small>this week</small>
            </div>
        </div>

        <div class="summary-card">
            <div class="summary-icon red">
                <i class="fa-solid fa-radiation"></i>
            </div>
            <div class="summary-text">
                <span>Critical Alerts</span>
                <h3>{{ $criticalCount ?? 4 }}</h3>
                <small>Require immediate Action</small>
            </div>
        </div>

        <div class="summary-card">
            <div class="summary-icon yellow">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div class="summary-text">
                <span>Warning Alerts</span>
                <h3>{{ $warningCount ?? 1 }}</h3>
                <small>Issue detected</small>
            </div>
        </div>

        <div class="summary-card">
            <div class="summary-icon green">
                <i class="fa-solid fa-circle-info"></i>
            </div>
            <div class="summary-text">
                <span>Info Notifications</span>
                <h3>{{ $infoCount ?? 4 }}</h3>
                <small>Process updates</small>
            </div>
        </div>

    </div>

    <!-- ACTION BUTTONS -->
    <div class="notif-actions">
        <button class="mark-read">
            <i class="fa-solid fa-check"></i> Mark all as Read
        </button>

        <button class="delete-btn">
            <i class="fa-solid fa-trash"></i> Delete
        </button>
    </div>

    <!-- MAIN CARD -->
    <div class="notif-card">

        <div class="notif-card-header">
            <h3>
                <i class="fa-solid fa-list"></i>
                All Notifications
            </h3>
            <div class="pagination-text">
                Page 1 of 10
            </div>
        </div>

        <div class="notif-list">

            <!-- SAMPLE HARD CODED (REMOVE LATER) -->
            @php
                $sample = [
                    ['type'=>'critical','title'=>'Temperature Sensor Failure','message'=>'Temperature sensor has stopped responding. Drying process may be affected.','time'=>'Just now'],
                    ['type'=>'info','title'=>'Drying Process Completed','message'=>'Drying process of Salmon completed successfully.','time'=>'5 minutes ago'],
                    ['type'=>'warning','title'=>'Humidity Slightly Above Ideal','message'=>'Humidity rising above optimal drying range','time'=>'23h ago'],
                    ['type'=>'info','title'=>'Drying Process Started','message'=>'New drying process started for 180 Pcs of Salmon.','time'=>'Just now'],
                ];
            @endphp

            @foreach($sample as $notif)

                @php
                    $color = $notif['type'];
                @endphp

                <div class="notif-item {{ $color }}">

                    <div class="left-line {{ $color }}"></div>

                    <input type="checkbox" class="notif-check">

                    <div class="notif-icon {{ $color }}">
                        @if($color=='critical')
                            <i class="fa-solid fa-radiation"></i>
                        @elseif($color=='warning')
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        @else
                            <i class="fa-solid fa-circle-info"></i>
                        @endif
                    </div>

                    <div class="notif-content">
                        <div class="notif-header">
                            <h4>{{ $notif['title'] }}</h4>
                            <span>{{ $notif['time'] }}</span>
                        </div>
                        <p>{{ $notif['message'] }}</p>
                    </div>

                    <div class="mail-icon">
                        <i class="fa-solid fa-envelope"></i>
                    </div>

                </div>

            @endforeach

        </div>

    </div>

</div>

@endsection