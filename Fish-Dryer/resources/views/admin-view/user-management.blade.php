@extends('admin-view.admin-view')

@section('content')

@vite([
    'resources/css/admin-view/user-management.css',
    'resources/css/admin-view/user-management-edit.css',
    'resources/js/user-management-edit.js',
    'resources/js/admin-delete-user.js'
])

<div class="user-management-container">

    <h2>User Management</h2>

    <div class="stats-cards">
        <div class="card">
            <h1>{{ $totalUsers }}</h1>
            <p>Total Users</p>
        </div>

        <div class="card highlight">
            <h1>{{ $activeUsers }}</h1>
            <p>Active Users</p>
        </div>
        <div class="card">
            <h1>{{ $inactiveUsers }}</h1>
            <p>Inactive Users</p>
        </div>
    </div>

    <div class="table-wrapper">

        <div class="table-top">
            <form method="GET" class="search-form">
                <div class="search-box">
                    <input type="text" name="search"
                        placeholder="Search users..."
                        value="{{ request('search') }}">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </div>
            </form>

            <button type="button" class="delete-btn">Delete</button>

        </div>

        <!-- ================= TABLE (NO WRAPPING FORM) ================= -->
        <table>
            <thead>
                <tr>
                    <th><input type="checkbox" id="selectAll"></th>
                    <th>ID</th>
                    <th>Profile</th>
                    <th>Name</th>
                    <th>Birthdate</th>
                    <th>Address</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>

            <tbody>
                @foreach($users as $user)
                <tr>

                    <td>
                        <input type="checkbox"
                               class="user-checkbox"
                               value="{{ $user->id }}">
                    </td>

                    <td>#USR-{{ str_pad($user->id, 2, '0', STR_PAD_LEFT) }}</td>

                    <td>
                        <div class="avatar">
                            @if($user->profile_picture)
                                <img src="{{ asset('storage/'.$user->profile_picture) }}">
                            @else
                                {{ strtoupper(substr($user->name, 0, 2)) }}
                            @endif
                        </div>
                    </td>

                    <td>{{ $user->name }}</td>
                    <td>{{ $user->birthdate }}</td>
                    <td>{{ $user->address }}</td>
                    <td>{{ $user->phone }}</td>
                    <td>{{ $user->email }}</td>

                    <td>
                        <span class="status {{ $user->status }}">
                            {{ ucfirst($user->status) }}
                        </span>
                    </td>

                    <td class="actions">

                        <!-- EDIT -->
                        <i class="fa-solid fa-pen-to-square edit-icon"
                            data-id="{{ $user->id }}"
                            data-name="{{ $user->name }}"
                            data-email="{{ $user->email }}"
                            data-phone="{{ $user->phone }}"
                            data-address="{{ $user->address }}"
                            data-birthdate="{{ $user->birthdate }}"
                            data-image="{{ $user->profile_picture ? asset('storage/'.$user->profile_picture) : '' }}">
                        </i>

                        <!-- VIEW -->
                        <i class="fa-solid fa-eye view-icon"></i>

                        <!-- TOGGLE -->
                        <form class="toggle-form"
                            data-id="{{ $user->id }}">
                            @csrf
                            @if($user->status === 'active')
                                <button type="button" class="toggle-btn"
                                        data-status="active">
                                    <i class="fa-solid fa-user-slash deactivate-icon"></i>
                                </button>
                            @else
                                <button type="button" class="toggle-btn"
                                        data-status="inactive">
                                    <i class="fa-solid fa-user-check activate-icon"></i>
                                </button>
                            @endif
                        </form>


                        <!-- SINGLE DELETE -->
                        <form action="{{ route('admin.users.delete', $user->id) }}"
                              method="POST"
                              class="single-delete-form">
                            @csrf
                            @method('DELETE')
                            <button type="button" class="delete-icon-btn">
                                <i class="fa-solid fa-trash delete-icon"></i>
                            </button>
                        </form>

                    </td>
                </tr>
                @endforeach
            </tbody>
        </table>

        <div class="pagination">
            {{ $users->withQueryString()->links() }}
        </div>

    </div>
</div>

<!-- CONFIRM MODAL -->
<div class="confirm-overlay" id="confirmDeleteModal" style="display:none;">
    <div class="confirm-card">
        <div class="confirm-icon">
            <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <h2>Are you sure you want to delete user?</h2>
        <div class="confirm-actions">
            <button id="confirmDeleteBtn" class="btn-confirm">Yes</button>
            <button id="cancelDeleteBtn" class="btn-cancel">Cancel</button>
        </div>
    </div>
</div>

<!-- HIDDEN BULK DELETE FORM -->
<form id="bulkDeleteForm"
      action="{{ route('admin.users.bulk.delete') }}"
      method="POST"
      style="display:none;">
    @csrf
    @method('DELETE')
</form>



<div class="success-overlay" id="successOverlay" style="display:none;">
    <div class="success-card">
        <div class="success-icon">
            <i class="fa-solid fa-check"></i>
        </div>
        <h2></h2>
    </div>
</div>



@include('admin-view.user-management-edit')

@endsection
