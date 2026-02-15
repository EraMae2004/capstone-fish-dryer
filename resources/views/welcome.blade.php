<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Login</title>

    @vite(['resources/css/app.css', 'resources/js/welcome.js'])

    <link rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
<body>

<div class="login-wrapper">

    <div class="login-container">

        <h1>Welcome Back</h1>
        <p class="subtitle">Sign in to your AutoDry Pro account</p>

        @if(session('error'))
            <div class="error">{{ session('error') }}</div>
        @endif

        <form method="POST" action="{{ route('api.login') }}">

            @csrf

            <div class="form-group">
                <label>
                    <i class="fa-solid fa-envelope"></i>
                    Email Address
                </label>
                <input type="email" name="email" placeholder="Enter your email" required>
            </div>

            <div class="form-group">
                <label>
                    <i class="fa-solid fa-lock"></i>
                    Password
                </label>

                <div class="password-wrapper">
                    <input type="password" name="password" class="password-input" placeholder="Enter your password" required>
                    <i class="fa-solid fa-eye toggle-password"></i>
                </div>
            </div>

            <div class="options">
                <label>
                    <input type="checkbox" name="remember">
                    Remember me
                </label>
                <a href="{{ route('api.forgot') }}">Forgot password?</a>
            </div>

            <button type="submit" class="login-btn">
                <i class="fa-solid fa-right-to-bracket"></i>
                Sign In
            </button>

            <div class="bottom-link">
                Already have an account?
                <a href="{{ url('/api/Authentication/signin') }}">Click here</a>
            </div>

        </form>

    </div>

</div>


</body>
</html>
