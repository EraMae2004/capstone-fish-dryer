<div class="edit-user-modal" id="editModal">
    <div class="edit-user-card">

        <div class="edit-header">
            <div class="edit-title">
                <i class="fa-solid fa-user-pen"></i>
                <span>Edit User</span>
            </div>
        </div>

        <div class="edit-title-line"></div>

        <form id="editUserForm" method="POST" enctype="multipart/form-data">
            @csrf
            @method('PUT')

            <input type="hidden" name="remove_image" id="remove_image" value="0">


            <div class="edit-top">

                <!-- LEFT -->
                <div class="edit-left">
                    <div class="edit-avatar" id="edit_avatar"></div>

                    <input type="file" id="edit_image_input" name="profile_picture" hidden>

                    <div class="edit-avatar-buttons">
                        <button type="button" class="btn-edit" id="btnChangeImage">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>

                        <button type="button" class="btn-remove" id="btnRemoveImage">
                            <i class="fa-solid fa-trash"></i> Remove
                        </button>
                    </div>
                </div>

                <!-- RIGHT -->
                <div class="edit-right">

                    <div class="edit-row">
                        <div class="edit-col">
                            <label>Name</label>
                            <input type="text" id="edit_name" name="name">
                        </div>

                        <div class="edit-col">
                            <label>Email</label>
                            <input type="email" id="edit_email" name="email">
                        </div>
                    </div>

                    <div class="edit-row">
                        <div class="edit-col">
                            <label>Birthdate</label>
                            <input type="date" id="edit_birthdate" name="birthdate">
                        </div>

                        <div class="edit-col">
                            <label>Contact No.</label>
                            <input type="text" id="edit_phone" name="phone">
                        </div>
                    </div>

                    <div class="edit-row single">
                        <div class="edit-col">
                            <label>Address</label>
                            <input type="text" id="edit_address" name="address">
                        </div>
                    </div>

                </div>
            </div>

            <div class="edit-divider"></div>

            <!-- PASSWORD SECTION -->
            <div class="edit-password">
                <h4>Change Password</h4>

                <div class="edit-row">
                    <div class="edit-col">
                        <label>New Password</label>
                        <input type="password" name="password">
                    </div>

                    <div class="edit-col">
                        <label>Confirm Password</label>
                        <input type="password" name="password_confirmation">
                    </div>
                </div>
            </div>

            <div class="edit-actions-bottom">
                <button type="submit" class="btn-save">Save</button>
                <button type="button" id="closeEditModal" class="btn-cancel">Cancel</button>
            </div>

        </form>

    </div>
</div>

@if(session('success'))
<div class="success-overlay" id="successOverlay">
    <div class="success-card">
        <div class="success-icon">
            <i class="fa-solid fa-check"></i>
        </div>

        <h2>Profile changes saved</h2>
    </div>
</div>

@endif
