<?php

use Illuminate\Support\Facades\Route;

use App\Http\Controllers\AuthController;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/login', [AuthController::class, 'login'])->name('login');

Route::middleware(['auth', 'role:user'])->group(function () {
    Route::get('/user-view', [AuthController::class, 'userView']);
});
