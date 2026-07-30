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
            $table->enum('component_name', [
                'esp32',
                'buzzer',
                'led_1',
                'led_2',
                'led_3',
                'door_sensor',
                'moisture_sensor',
                'heater_1',
                'heater_2',
                'fan_1',
                'fan_2',
                'fan_3',
                'dht22',
                'lcd',
                'keypad',
            ]);
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
