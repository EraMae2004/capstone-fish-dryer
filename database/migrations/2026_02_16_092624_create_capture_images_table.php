<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('capture_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('capture_session_id')->constrained('capture_sessions')->onDelete('cascade');
            $table->integer('tray_number');
            $table->enum('side', ['front', 'back']);
            $table->string('image_path');
            $table->integer('detected_fully_dried')->default(0);
            $table->integer('detected_partially_dried')->default(0);
            $table->integer('detected_not_dried')->default(0);
            $table->text('image_description')->nullable();
            $table->text('drying_recommendation')->nullable();
            $table->timestamps();
        });

    }

    public function down(): void
    {
        Schema::dropIfExists('capture_images');
    }
};
