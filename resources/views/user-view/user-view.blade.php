<!DOCTYPE html>
<html>
<head>
    <title>Fish Dryer - User</title>
    <meta name="csrf-token" content="{{ csrf_token() }}">


    @vite(['resources/css/user-view/user-view.css'])

    <link rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>

<body>

<!-- ================= LAYOUT ================= -->
<div class="layout">

    <!-- ================= TOP BAR ================= -->
    <div class="topbar">

        <div class="logo-section">

            <svg viewBox="0 0 512 512"
                xmlns="http://www.w3.org/2000/svg"
                width="45"
                height="45"
                class="logo-icon">
                <path fill="#0F80D7"
                    d="M352.57 128c-28.09 0-54.09 4.52-77.06 12.86l12.41-123.11C289 7.31 279.81-1.18 269.33.13 189.63 10.13 128 77.64 128 159.43c0 28.09 4.52 54.09 12.86 77.06L17.75 224.08C7.31 223-1.18 232.19.13 242.67c10 79.7 77.51 141.33 159.3 141.33 28.09 0 54.09-4.52 77.06-12.86l-12.41 123.11c-1.05 10.43 8.11 18.93 18.59 17.62 79.7-10 141.33-77.51 141.33-159.3 0-28.09-4.52-54.09-12.86-77.06l123.11 12.41c10.44 1.05 18.93-8.11 17.62-18.59-10-79.7-77.51-141.33-159.3-141.33zM256 288a32 32 0 1 1 32-32 32 32 0 0 1-32 32z">
                </path>
            </svg>

            <span class="system-name">
                Fish Dryer
            </span>

        </div>

        <div class="user-section">
            <div class="profile-circle">
                @if(Auth::user()->profile_picture)
                    <img src="{{ asset('storage/' . Auth::user()->profile_picture) }}">
                @else
                    {{ strtoupper(substr(Auth::user()->name, 0, 2)) }}
                @endif
            </div>

            <span class="username">
                {{ Auth::user()->name }}
            </span>
        </div>

    </div>

    <!-- ================= END TOP BAR ================= -->


    <!-- ================= MAIN ================= -->
    <div class="main">

        <!-- ================= SIDEBAR ================= -->
        <div class="sidebar">

            <a href="{{ route('user.overview') }}"
            class="menu-item {{ request()->routeIs('user.overview') ? 'active' : '' }}">
                <i class="fa-solid fa-gauge"></i>
                Overview
            </a>

            <a href="{{ route('user.history') }}"
            class="menu-item {{ request()->routeIs('user.history') ? 'active' : '' }}">
                <i class="fa-solid fa-clock-rotate-left"></i>
                History
            </a>

            <a href="{{ route('user.notifications') }}"
            class="menu-item {{ request()->routeIs('user.notifications') ? 'active' : '' }}">
                <i class="fa-solid fa-bell"></i>
                Notifications
            </a>

            <a href="{{ route('user.hardware') }}"
            class="menu-item {{ request()->routeIs('user.hardware') ? 'active' : '' }}">
                <i class="fa-solid fa-microchip"></i>
                Hardware Status
            </a>

            <a href="{{ route('user.profile') }}"
            class="menu-item {{ request()->routeIs('user.profile') ? 'active' : '' }}">
                <i class="fa-solid fa-user"></i>
                Profile
            </a>

            <div class="divider"></div>

            <form method="POST" action="{{ route('logout') }}">
                @csrf
                <a href="#"
                onclick="event.preventDefault(); this.closest('form').submit();"
                class="menu-item logout">
                    <i class="fa-solid fa-right-from-bracket"></i>
                    Logout
                </a>
            </form>


        </div>

        <!-- ================= END SIDEBAR ================= -->


        <div class="content">
            @yield('content')
        </div>

    </div>
    <!-- ================= END MAIN ================= -->

</div>
<!-- ================= END LAYOUT ================= -->

</body>
</html>
