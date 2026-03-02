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
            $table->foreignId('drying_session_id')->constrained('drying_sessions')->onDelete('cascade');
            $table->integer('tray_number');
            $table->enum('final_status', ['fully_dried','partially_dried','not_dried'])->nullable();
            $table->timestamps();
        });


    }

    public function down(): void
    {
        Schema::dropIfExists('drying_batches');
    }
};
