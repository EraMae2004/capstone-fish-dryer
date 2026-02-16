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
            $table->foreignId('machine_id')->constrained('machines')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->string('fish_type');
            $table->integer('quantity');
            $table->enum('quantity_unit', ['pcs', 'kg']);
            $table->decimal('initial_temperature', 5, 2);
            $table->decimal('initial_humidity', 5, 2);
            $table->decimal('initial_target_moisture', 5, 2);
            $table->unsignedTinyInteger('fan_speed');
            $table->integer('initial_duration_minutes');
            $table->integer('extension_minutes')->default(0);
            $table->integer('total_duration_minutes')->nullable();
            $table->boolean('recommendation_applied')->default(false);
            $table->enum('status', ['running','paused','extended','completed','stopped','discarded'])->default('running');
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
