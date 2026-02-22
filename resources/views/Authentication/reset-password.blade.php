<!DOCTYPE html>
<html>
<head>
    <title>Reset Password</title>

    @vite([
        'resources/css/Authentication/reset-password.css',
        'resources/js/reset-password.js'
    ])

    <meta name="csrf-token" content="{{ csrf_token() }}">

    <link rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
<body>

<div class="wrapper">
    <div class="container">

        <a href="{{ route('forgot') }}" class="back-arrow">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <h2>Reset Password</h2>

        <form id="resetForm" method="POST" action="{{ route('reset.submit') }}">
            @csrf

            <!-- NEW PASSWORD -->
            <label>
                <i class="fa-solid fa-lock"></i>
                New Password
            </label>
            <div class="password-wrapper">
                <input type="password" name="password" required>
                <i class="fa-solid fa-eye toggle-password"></i>
            </div>

            <!-- CONFIRM PASSWORD -->
            <label>
                <i class="fa-solid fa-lock"></i>
                Confirm Password
            </label>
            <div class="password-wrapper">
                <input type="password" name="password_confirmation" required>
                <i class="fa-solid fa-eye toggle-password"></i>
            </div>

            <button type="submit">Update Password</button>
        </form>

    </div>
</div>

<!-- MODAL -->
<div id="resultModal" class="modal-overlay" style="display:none;">
    <div class="modal-box">
        <i id="modalIcon" class="fa-solid"></i>
        <h3 id="modalMessage"></h3>
    </div>
</div>

</body>
</html>
