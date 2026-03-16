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
Route::get('/mobile/user/{id}', [MobileAuthController::class, 'getUser']);
Route::get('/drying-sessions', [MobileDryingController::class, 'index']);
Route::get('/drying-sessions/{id}', [MobileDryingController::class, 'show']);
Route::post('/mobile/update-profile/{id}', [MobileAuthController::class, 'updateProfile']);
Route::post('/mobile/change-password/{id}', [MobileAuthController::class, 'changePassword']);

