<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('machine_hardware_status', function (Blueprint $table) {
            $table->id();
            $table->foreignId('machine_id')->constrained('machines')->onDelete('cascade');
            $table->enum('component_name', ['esp32','lcd','fan','buzzer','led','temp_humidity_sensor','moisture_sensor']);
            $table->enum('status', ['working','warning','not_working'])->default('working');
            $table->timestamp('last_checked_at')->nullable();
            $table->timestamps();
        });
    }


    public function down(): void
    {
        Schema::dropIfExists('machine_hardware_status');
    }
};
