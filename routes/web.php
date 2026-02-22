<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Auth;

use App\Http\Controllers\AuthController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\DryingController;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
*/

Route::get('/', function () {
    return view('welcome');
})->name('home');

/*
|--------------------------------------------------------------------------
| AUTH ROUTES
|--------------------------------------------------------------------------
*/

Route::post('/login', [AuthController::class, 'login'])->name('login');

Route::post('/register', [AuthController::class, 'register'])->name('register');

Route::post('/logout', function () {
    Auth::logout();
    request()->session()->invalidate();
    request()->session()->regenerateToken();
    return redirect('/');
})->name('logout');


/*
|--------------------------------------------------------------------------
| USER ROUTES
|--------------------------------------------------------------------------
*/

Route::middleware(['auth', 'role:user'])->group(function () {

    Route::get('/overview', [DryingController::class, 'overview'])->name('user.overview');

    Route::get('/history', [DryingController::class, 'history'])->name('user.history');

    Route::get('/notifications', function () {
        return view('user-view.user-notifications');
    })->name('user.notifications');

    Route::get('/hardware', [DryingController::class, 'hardware'])->name('user.hardware');

    Route::get('/profile', function () {
        return view('user-view.user-profile');
    })->name('user.profile');

    Route::post('/user/profile/update',
        [AuthController::class, 'updateUserProfile']
    )->name('user.profile.update');

    Route::post('/user/change-password',
        [AuthController::class, 'changePassword']
    )->name('user.change.password');
});


/*
|--------------------------------------------------------------------------
| ADMIN ROUTES
|--------------------------------------------------------------------------
*/

Route::middleware(['auth', 'role:admin'])->group(function () {

    Route::get('/admin/overview', function () {
        return view('admin-view.admin-overview');
    })->name('admin.overview');

    Route::get('/admin/user-management',
        [AdminController::class, 'userManagement']
    )->name('admin.user-management');

    Route::put('/admin/users/{id}',
        [AdminController::class, 'updateUser']
    )->name('admin.users.update');

    Route::delete('/admin/users/{id}',
        [AdminController::class, 'deleteUser']
    )->name('admin.users.delete');

    Route::delete('/admin/users',
        [AdminController::class, 'bulkDeleteUsers']
    )->name('admin.users.bulk.delete');

    Route::patch('/admin/users/{id}/toggle-status',
        [AdminController::class, 'toggleUserStatus']
    )->name('admin.user.toggle');

    Route::get('/admin/drying-machines', function () {
        return view('admin-view.drying-machine');
    })->name('admin.drying-machines');

    Route::get('/admin/profile', function () {
        return view('admin-view.admin-profile');
    })->name('admin.profile');

    Route::post('/admin/profile/update',
        [AuthController::class, 'updateAdminProfile']
    )->name('admin.profile.update');

    Route::post('/admin/change-password',
        [AuthController::class, 'changeAdminPassword']
    )->name('admin.change.password');
});


/*
|--------------------------------------------------------------------------
| PASSWORD RECOVERY
|--------------------------------------------------------------------------
*/

Route::get('/signin', function () {
    return view('Authentication.signin');
})->name('signin');

Route::get('/forgot-password', function () {
    return view('Authentication.forgot-password');
})->name('forgot');

Route::post('/verify-identity', [AuthController::class, 'verifyIdentity'])
    ->name('verify.identity');

Route::get('/reset-password', function () {
    if (!session('verified_user')) {
        return redirect()->route('forgot');
    }
    return view('Authentication.reset-password');
})->name('reset.form');

Route::post('/reset-password',
    [AuthController::class, 'resetPassword']
)->name('reset.submit');