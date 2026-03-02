<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('machines', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->enum('status', ['online', 'offline'])->default('offline');
            $table->timestamp('last_used_at')->nullable();
            $table->enum('overall_health', ['healthy', 'warning', 'critical'])->default('healthy');
            $table->foreignId('created_by')->constrained('users')->onDelete('cascade');
            $table->timestamps();
        });


    }

    public function down(): void
    {
        Schema::dropIfExists('machines');
    }
};
