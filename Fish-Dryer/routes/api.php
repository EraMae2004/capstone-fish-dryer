<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Mobile\AuthController as MobileAuthController;
use App\Http\Controllers\Mobile\DryingController as MobileDryingController;
use App\Http\Controllers\Mobile\DryingController;

// API Routes for Mobile App

Route::post('/mobile/register', [MobileAuthController::class, 'register']);
Route::post('/mobile/login', [MobileAuthController::class, 'login']);
Route::post('/mobile/verify-identity', [MobileAuthController::class, 'verifyIdentity']);
Route::post('/mobile/reset-password', [MobileAuthController::class, 'resetPassword']);
Route::post('/ai/analyze', [DryingController::class, 'analyzeBatch']);


Route::get('/mobile/overview', [MobileDryingController::class, 'overview']);
Route::get('/mobile/recommendation', [MobileDryingController::class, 'recommendation']);
Route::get('/mobile/user/{id}', [MobileAuthController::class, 'getUser']);
Route::get('/drying-sessions', [MobileDryingController::class, 'index']);
Route::get('/drying-sessions/{id}', [MobileDryingController::class, 'show']);
Route::delete('/drying-sessions/{id}', [MobileDryingController::class, 'destroy']);
Route::post('/mobile/update-profile/{id}', [MobileAuthController::class, 'updateProfile']);
Route::post('/mobile/change-password/{id}', [MobileAuthController::class, 'changePassword']);

// ESP32 heartbeat endpoint for hardware status
Route::post('/hardware/esp32/status', [DryingController::class, 'esp32Heartbeat']);

 Route::get('/hardware', [DryingController::class, 'hardware'])->name('user.hardware');
    Route::get('/detect-esp', [DryingController::class, 'detectEsp'])
    ->name('user.detect.esp');