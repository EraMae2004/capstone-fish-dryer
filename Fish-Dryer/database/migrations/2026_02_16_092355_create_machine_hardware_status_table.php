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
            $table->foreignId('microcontroller_id')->constrained('microcontrollers')->onDelete('cascade');
            $table->enum('component_name', ['esp32','solar_panel','heater_fan_1', 'heater_fan_2', 'ventilation_fan', 'heater_1', 'heater_2', 'buzzer','led_drying', 'led_pause', 'led_stop', 'temp_humidity_sensor','moisture_sensor']);
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
