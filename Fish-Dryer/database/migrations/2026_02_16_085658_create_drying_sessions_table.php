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
            $table->string('fish_type')->nullable();
            $table->integer('total_fish')->nullable();
            $table->integer('drying_time_minutes')->default(0);
            $table->integer('extension_minutes')->default(0);
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
