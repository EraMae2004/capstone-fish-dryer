<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Mobile\AuthController as MobileAuthController;
use App\Http\Controllers\Mobile\DryingController as MobileDryingController;
use App\Http\Controllers\DryingController;




Route::post('/mobile/login', [MobileAuthController::class, 'login']);
Route::post('/ai/detect', [DryingController::class, 'detectFish']);

Route::get('/mobile/overview', [MobileDryingController::class, 'overview']);
Route::get('/mobile/user/{id}', [MobileAuthController::class, 'getUser']);
Route::post('/mobile/update-profile/{id}', [MobileAuthController::class, 'updateProfile']);
Route::post('/mobile/change-password/{id}', [MobileAuthController::class, 'changePassword']);

