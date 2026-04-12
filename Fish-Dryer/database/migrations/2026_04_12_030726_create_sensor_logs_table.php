<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('sensor_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('drying_session_id')->constrained('drying_sessions')->onDelete('cascade');

            $table->float('temperature');
            $table->float('humidity');
            $table->float('moisture');
            $table->integer('fan_speed');

            // POWER SOURCE (IMPORTANT)
            $table->enum('power_source', ['grid', 'solar'])->default('grid');

            $table->timestamp('recorded_at');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sensor_logs');
    }
};
