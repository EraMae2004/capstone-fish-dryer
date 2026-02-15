<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('drying_batches', function (Blueprint $table) {
            $table->id();
            $table->string('batch_code')->unique();
            $table->foreignId('machine_id')->constrained('machines')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->string('fish_type');
            $table->integer('quantity');
            $table->enum('quantity_unit', ['pcs', 'kg']);
            $table->decimal('target_temperature', 5, 2);
            $table->decimal('target_humidity', 5, 2);
            $table->decimal('target_moisture', 5, 2);
            $table->decimal('final_temperature', 5, 2)->nullable();
            $table->decimal('final_humidity', 5, 2)->nullable();
            $table->decimal('final_moisture', 5, 2)->nullable();
            $table->unsignedTinyInteger('fan_speed');
            $table->integer('planned_duration_minutes');
            $table->integer('actual_duration_minutes')->nullable();
            $table->enum('status', ['running','completed','extended','stopped'])->default('running');
            $table->timestamp('started_at');
            $table->timestamp('completed_at')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });

    }

    public function down(): void
    {
        Schema::dropIfExists('drying_batches');
    }
};
