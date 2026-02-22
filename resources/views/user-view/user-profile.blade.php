@extends('user-view.user-view')

@section('content')

@vite(['resources/css/user-view/user-profile.css', 'resources/js/user-change-password.js'])

<div class="profile-container">

    <div class="profile-header">
        <h2>Profile</h2>

        <button type="button"
                class="change-password-btn"
                id="openPasswordBtn">
            <i class="fa-solid fa-key"></i> Change Password
        </button>
    </div>

    <form id="userProfileForm"
        method="POST"
        action="{{ route('user.profile.update') }}"
        enctype="multipart/form-data">
        @csrf

        <input type="hidden" name="remove_image"
               id="removeImageFlag" value="0">

        <div class="profile-card">

            <div class="card-header-section">
                <h3>
                    <i class="fa-solid fa-id-card"></i>
                    Personal Information
                </h3>
            </div>

            <div class="card-divider"></div>

            <div class="profile-body">

                <div class="profile-picture-section">

                    <div class="profile-large-circle"
                         id="previewContainer"
                         data-initial="{{ strtoupper(substr(Auth::user()->name, 0, 2)) }}">

                        @if(Auth::user()->profile_picture)
                            <img src="{{ asset('storage/' . Auth::user()->profile_picture) }}">
                        @else
                            {{ strtoupper(substr(Auth::user()->name, 0, 2)) }}
                        @endif
                    </div>

                    <div class="profile-actions">

                        <input type="file"
                               name="profile_picture"
                               id="profileInput"
                               hidden
                               accept="image/*">

                        <button type="button"
                                class="edit-btn"
                                onclick="document.getElementById('profileInput').click();">
                            <i class="fa-solid fa-pen"></i> Edit
                        </button>

                        <button type="button"
                                class="remove-btn"
                                onclick="removeImage();">
                            <i class="fa-solid fa-trash"></i> Remove
                        </button>

                    </div>
                </div>

                <div class="profile-form">

                    <div class="form-group">
                        <label>Name</label>
                        <input type="text"
                               name="name"
                               value="{{ Auth::user()->name }}">
                    </div>

                    <div class="form-group">
                        <label>Contact No.</label>
                        <input type="text"
                               name="phone"
                               value="{{ Auth::user()->phone }}">
                    </div>

                    <div class="form-group">
                        <label>Birthdate</label>
                        <input type="date"
                               name="birthdate"
                               value="{{ optional(Auth::user()->birthdate)->format('Y-m-d') }}">
                    </div>

                    <div class="form-group">
                        <label>Email</label>
                        <input type="email"
                               name="email"
                               value="{{ Auth::user()->email }}">
                    </div>

                    <div class="form-group">
                        <label>Address</label>
                        <input type="text"
                               name="address"
                               value="{{ Auth::user()->address }}">
                    </div>

                </div>

            </div>

            <div class="profile-footer">
                <button type="button"
                        class="save-btn"
                        onclick="submitUserProfile()">
                    Save
                </button>

                <button type="button"
                        class="cancel-btn"
                        onclick="discardUserChanges()">
                    Cancel
                </button>
            </div>

        </div>

    </form>

</div>

<!-- PASSWORD MODAL -->
<div id="passwordModal" class="modal">
    <div class="password-card">

        <div class="modal-header">
            <span class="back-btn" onclick="closePasswordModal()">
                <i class="fa-solid fa-arrow-left"></i>
            </span>
            <h2>Reset Password</h2>
        </div>

        <p id="passwordErrorMessage"
           style="color:#dc3545;
                  font-weight:600;
                  margin-bottom:15px;
                  display:none;">
        </p>

        <div class="field-group">
            <label>Current Password</label>
            <div class="password-input">
                <input type="password" id="current_password">
                <i class="fa-solid fa-eye toggle-eye"
                   onclick="togglePassword('current_password', this)"></i>
            </div>
        </div>

        <div class="field-group">
            <label>New Password</label>
            <div class="password-input">
                <input type="password" id="new_password">
                <i class="fa-solid fa-eye toggle-eye"
                   onclick="togglePassword('new_password', this)"></i>
            </div>
        </div>

        <div class="field-group">
            <label>Confirm Password</label>
            <div class="password-input">
                <input type="password" id="confirm_password">
                <i class="fa-solid fa-eye toggle-eye"
                   onclick="togglePassword('confirm_password', this)"></i>
            </div>
        </div>

        <button class="update-btn"
                onclick="openConfirmModal()">
            Update Password
        </button>

    </div>
</div>

<!-- CONFIRM MODAL -->
<div id="confirmModal" class="modal">
    <div class="confirm-card">
        <h3 class="confirm-title">
            Are you sure you want to save?
        </h3>
        <div class="confirm-actions">
            <button class="confirm-yes-btn"
                    onclick="submitPassword()">Yes</button>
            <button class="confirm-no-btn"
                    onclick="closeConfirmModal()">No</button>
        </div>
    </div>
</div>

<!-- ACTION MODAL -->
<div id="profileActionModal" class="modal">
    <div class="success-card">
        <div class="check-icon">
            <i class="fa-solid fa-check"></i>
        </div>
        <h3 id="profileActionMessage"></h3>
    </div>
</div>

@endsection
