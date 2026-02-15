<!DOCTYPE html>
<html>
<head>
    <title>User Registration</title>
    @vite(['resources/css/Authentication/signin.css', 'resources/js/signin.js'])
    <link rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>

<body>

<div class="register-wrapper">

    <div class="register-container">

        <h2>Create Account</h2>

        <form id="registerForm" method="POST" action="{{ route('api.register') }}" enctype="multipart/form-data">
            @csrf


            <div class="register-grid">

                <!-- LEFT COLUMN -->
                <div class="profile-section">
                    <div class="profile-preview">
                        <img id="previewImage" src="https://via.placeholder.com/180" alt="Profile">
                    </div>

                    <div class="profile-buttons">
                        <label class="upload-btn">
                            <i class="fa-solid fa-upload"></i> Upload
                            <input type="file" id="imageInput" name="profile_picture" accept="image/*" hidden>
                        </label>

                        <button type="button" class="remove-btn" id="removeImage">
                            <i class="fa-solid fa-trash"></i> Remove
                        </button>
                    </div>
                </div>

                <!-- MIDDLE COLUMN -->
                <div class="form-column">
                    <label><i class="fa-solid fa-user"></i> Name</label>
                    <input type="text" name="name">
                    <small class="error-text" data-error="name"></small>


                    <label><i class="fa-solid fa-calendar"></i> Birthdate</label>
                    <input type="date" name="birthdate">

                    <label><i class="fa-solid fa-location-dot"></i> Address</label>
                    <input type="text" name="address">

                    <label><i class="fa-solid fa-phone"></i> Phone</label>
                    <input type="text" name="phone">
                    <small class="error-text" data-error="phone"></small>

                </div>

                <!-- RIGHT COLUMN -->
                <div class="form-column">

                    <label><i class="fa-solid fa-envelope"></i> Email</label>
                    <input type="email" name="email">
                    <small class="error-text" data-error="email"></small>


                    <label><i class="fa-solid fa-lock"></i> Password</label>
                    <div class="password-wrapper">
                        <input type="password" name="password">
                        <small class="error-text" data-error="password"></small>

                        <i class="fa-solid fa-eye"></i>
                    </div>


                    <label><i class="fa-solid fa-lock"></i> Confirm Password</label>
                    <div class="password-wrapper">
                        <input type="password" name="password_confirmation">
                        <small class="error-text" data-error="password_confirmation"></small>
                        <i class="fa-solid fa-eye"></i>
                    </div>


                </div>

            </div>

            <div class="button-section">
                <button type="submit">Register</button>
            </div>

            <div class="bottom-link">
                Already have an account?
                <a href="{{ url('/') }}">Click here</a>
            </div>
        </form>


    </div>

</div>

<!-- SUCCESS MODAL -->
<div id="successModal" class="modal-overlay" style="display:none;">
    <div class="modal-box">
        <i class="fa-solid fa-circle-check"></i>
        <h3>Registration Successful!</h3>
    </div>
</div>



</body>
</html>
