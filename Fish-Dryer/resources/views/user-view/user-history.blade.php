@extends('user-view.user-view')

@section('content')
@vite(['resources/css/user-view/user-history.css'])

<div class="history-wrapper">

    <!-- ===== TITLE ===== -->
    <div class="history-header">
        <h2>Drying History</h2>
    </div>

    <!-- ===== FILTER SECTION ===== -->
    <div class="history-filters">

        <select class="filter-select">
            <option>Drying Machine 1</option>
        </select>

        <select class="filter-select">
            <option>Last 30 days</option>
        </select>

        <div class="search-box">
            <input type="text" placeholder="Search history...">
            <i class="fa fa-search"></i>
        </div>

    </div>

    <!-- ===== SUMMARY CARDS ===== -->
    <div class="summary-cards">

        <div class="summary-card">
            <div class="summary-number">
                {{ $histories->count() ?? 0 }}
            </div>
            <div class="summary-label">Total Batches</div>
        </div>

        <div class="summary-card">
            <div class="summary-number">
                {{ number_format($avgDuration ?? 0,1) }}h
            </div>
            <div class="summary-label">Avg. Duration</div>
        </div>

        <div class="summary-card">
            <div class="summary-number">
                {{ $avgMoisture ?? 0 }}%
            </div>
            <div class="summary-label">Avg. Moisture</div>
        </div>

    </div>

    <!-- ===== TABLE CARD ===== -->
    <div class="table-card">

        <div class="table-card-header">
            <div class="table-title">
                <i class="fa fa-table"></i>
                Drying History Records
            </div>

            <button class="delete-btn">Delete</button>
        </div>

        <table class="history-table">
            <thead>
                <tr>
                    <th><input type="checkbox"></th>
                    <th>ID</th>
                    <th>Date & Time</th>
                    <th>Type of Fish</th>
                    <th>No. of Fish</th>
                    <th>Fan Speed</th>
                    <th>Temperature</th>
                    <th>Moisture</th>
                    <th>Humidity</th>
                    <th>Duration</th>
                    <th>Actions</th>
                </tr>
            </thead>

            <tbody>

                @forelse($histories as $history)
                    <tr>
                        <td><input type="checkbox"></td>

                        <td>#DRY-{{ $history->id }}</td>

                        <td>
                            {{ \Carbon\Carbon::parse($history->created_at)->format('m-d-y H:i') }}
                        </td>

                        <td>{{ $history->fish_type }}</td>

                        <td>{{ $history->quantity }} {{ $history->quantity_unit }}</td>

                        <td>{{ $history->fan_speed }}</td>

                        <td>{{ $history->target_temperature }}°C</td>

                        <td>{{ $history->target_moisture }}%</td>

                        <td>{{ $history->target_humidity }}%</td>

                        <td>
                            {{ gmdate("H:i:s", $history->actual_duration_minutes * 60) }}
                        </td>

                        <td class="actions">
                            <a href="#" class="view-icon">
                                <i class="fa fa-eye"></i>
                            </a>

                            <a href="#" class="delete-icon">
                                <i class="fa fa-trash"></i>
                            </a>
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="11" class="no-data">
                            No drying history found.
                        </td>
                    </tr>
                @endforelse

            </tbody>
        </table>

        <!-- Pagination -->
        <div class="pagination">
            <span>Page 1 of 10</span>
        </div>

    </div>

</div>

@endsection
