<!DOCTYPE html>
<html>
<head>
    <title>Forgot Password</title>
    @vite(['resources/css/Authentication/forgot-password.css'])
    <link rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
<body>

<div class="wrapper">
    <div class="container">

        <a href="{{ url('/') }}" class="back-arrow">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <h2>Forgot Password</h2>

        @if(session('error'))
            <div class="error">{{ session('error') }}</div>
        @endif

        <form method="POST" action="{{ route('verify.identity') }}">
            @csrf

            <label><i class="fa-solid fa-envelope"></i> Email</label>
            <input type="email" name="email" required>

            <label><i class="fa-solid fa-phone"></i> Phone</label>
            <input type="text" name="phone" required>

            <label><i class="fa-solid fa-location-dot"></i> Address</label>
            <input type="text" name="address" required>

            <button type="submit">Reset Password</button>
        </form>

    </div>
</div>

</body>
</html>
