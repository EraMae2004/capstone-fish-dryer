<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\DryingController;


/*
|--------------------------------------------------------------------------
| API Routes (Session-enabled via middleware configuration)
|--------------------------------------------------------------------------
*/

// Authentication
Route::post('/login', [AuthController::class, 'login'])->name('api.login');
Route::post('/register', [AuthController::class, 'register'])->name('api.register');
Route::post('/logout', function () {
    Auth::logout();
    request()->session()->invalidate();
    request()->session()->regenerateToken();
    return redirect('/');
})->name('api.logout');


// Views
Route::middleware(['auth', 'role:user'])->group(function () {

    Route::get('/overview',
        [DryingController::class, 'overview']
    )->name('api.user.overview');

    Route::get('/history',
        [DryingController::class, 'history']
    )->name('api.user.history');


    Route::get('/notifications', function () {
        return view('user-view.user-notifications');
    })->name('api.user.notifications');

    Route::get('/hardware',
        [DryingController::class, 'hardware']
    )->name('api.user.hardware');

    Route::get('/profile', function () {
        return view('user-view.user-profile');
    })->name('api.user.profile');

    Route::post('/user/profile/update',
        [AuthController::class, 'updateUserProfile']
    )->name('api.user.profile.update');

    Route::post('/user/change-password',
        [AuthController::class, 'changePassword']
    )->name('api.user.change.password');


});





Route::middleware(['auth', 'role:admin'])->group(function () {

    Route::get('/admin/overview', function () {
        return view('admin-view.admin-overview');
    })->name('api.admin.overview');

    Route::get('/admin/user-management',
        [AdminController::class, 'userManagement']
    )->name('api.admin.user-management');

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
    )->name('api.admin.user.toggle');


    Route::get('/admin/drying-machines', function () {
        return view('admin-view.drying-machine');
    })->name('api.admin.drying-machines');


    Route::get('/admin/profile', function () {
        return view('admin-view.admin-profile');
    })->name('api.admin.profile');

    Route::post('/admin/profile/update',
        [AuthController::class, 'updateAdminProfile']
    )->name('api.admin.profile.update');

    Route::post('/admin/change-password',
        [AuthController::class, 'changeAdminPassword']
    )->name('api.admin.change.password');

});






    
// Register view (if you really want it under api)
Route::get('/Authentication/signin', function () {
    return view('Authentication.signin');
})->name('api.signin');

Route::get('/forgot-password', function () {
    return view('Authentication.forgot-password');
})->name('api.forgot');

Route::post('/verify-identity', [AuthController::class, 'verifyIdentity'])
    ->name('api.verify');

Route::get('/reset-password', function () {
    if (!session('verified_user')) {
        return redirect()->route('api.forgot');
    }
    return view('Authentication.reset-password');
})->name('api.reset.form');

Route::post('/reset-password', [AuthController::class, 'resetPassword'])
    ->name('api.reset.submit');
