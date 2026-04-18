<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('drying_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('session_code')->unique();
            $table->foreignId('microcontroller_id')->constrained('microcontrollers')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->string('fish_type')->nullable();
            $table->integer('total_fish')->nullable();
            $table->float('target_temperature')->nullable();
            $table->integer('fan_speed')->nullable();
            $table->integer('set_duration_minutes')->nullable();
            $table->integer('drying_time_minutes')->default(0);
            $table->enum('status', ['running','paused','completed','stopped'])->default('running');
            $table->enum('final_status', ['fully_dried', 'semi_dried', 'not_dried'])->nullable();
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('drying_sessions');
    }
};
