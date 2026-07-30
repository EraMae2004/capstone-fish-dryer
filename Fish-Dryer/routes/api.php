<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Mobile\AuthController as MobileAuthController;
use App\Http\Controllers\Mobile\DryingController as MobileDryingController;
use App\Http\Controllers\DryingController as WebDryingController;

// API Routes for Mobile App

Route::post('/mobile/register', [MobileAuthController::class, 'register']);
Route::post('/mobile/login', [MobileAuthController::class, 'login']);
Route::post('/mobile/verify-identity', [MobileAuthController::class, 'verifyIdentity']);
Route::post('/mobile/reset-password', [MobileAuthController::class, 'resetPassword']);
Route::post('/ai/analyze', [MobileDryingController::class, 'analyzeBatch']);


Route::get('/mobile/overview', [MobileDryingController::class, 'overview']);
Route::get('/mobile/machines/{machineId}/firebase', [MobileDryingController::class, 'firebaseTelemetry']);
Route::get('/mobile/recommendation', [MobileDryingController::class, 'recommendation']);
Route::get('/mobile/user/{id}', [MobileAuthController::class, 'getUser']);
Route::get('/drying-sessions', [MobileDryingController::class, 'index']);
Route::get('/drying-sessions/{id}', [MobileDryingController::class, 'show']);
Route::delete('/drying-sessions/{id}', [MobileDryingController::class, 'destroy']);
Route::post('/drying-sessions/batch-delete', [MobileDryingController::class, 'destroyBatch']);
Route::post('/mobile/drying-session/control', [MobileDryingController::class, 'sessionControl']);
Route::post('/mobile/drying-session/moisture-check', [MobileDryingController::class, 'saveMoistureCheck']);
Route::delete('/mobile/drying-session/moisture-check/{logId}', [MobileDryingController::class, 'deleteMoistureCheck']);
Route::get('/notifications', [MobileDryingController::class, 'notificationsIndex']);
Route::post('/notifications/mark-read', [MobileDryingController::class, 'notificationsMarkRead']);
Route::post('/notifications/delete-batch', [MobileDryingController::class, 'notificationsDestroyBatch']);
Route::post('/mobile/update-profile/{id}', [MobileAuthController::class, 'updateProfile']);
Route::post('/mobile/update-profile-photo/{id}', [MobileAuthController::class, 'updateProfilePhoto']);
Route::post('/mobile/change-password/{id}', [MobileAuthController::class, 'changePassword']);
Route::get('/machines', [MobileDryingController::class, 'getMachines']);
Route::post('/machines', [MobileDryingController::class, 'addMachine']);
Route::delete('/machines/{machineId}', [MobileDryingController::class, 'deleteMachine']);
Route::get('/machines/{machineId}/components', [MobileDryingController::class, 'getComponents']);
Route::post('/machines/{machineId}/components/test-all', [MobileDryingController::class, 'testAllComponents']);
Route::post('/machines/{machineId}/components/{componentName}/test', [MobileDryingController::class, 'testComponent']);
Route::post('/machines/detect', [MobileDryingController::class, 'detectMicrocontrollers']);
Route::get('/machines/detect', [MobileDryingController::class, 'detectMicrocontrollers']);

// ESP32 heartbeat endpoint for hardware status (mobile API controller only)
Route::post('/hardware/esp32/status', [MobileDryingController::class, 'esp32Heartbeat']);
Route::get('/hardware/esp32/status', [MobileDryingController::class, 'esp32Heartbeat']);
Route::post('/hardware/esp32/session', [MobileDryingController::class, 'esp32LocalSession']);

Route::get('/hardware', [WebDryingController::class, 'hardware'])->name('user.hardware');
Route::get('/detect-esp', [WebDryingController::class, 'detectEsp'])->name('user.detect.esp');