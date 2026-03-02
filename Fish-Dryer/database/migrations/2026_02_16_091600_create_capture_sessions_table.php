<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{

    public function up(): void
    {
        Schema::create('capture_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('drying_batch_id')->constrained('drying_batches')->onDelete('cascade');
            $table->integer('capture_round');
            $table->integer('total_fully_dried')->default(0);
            $table->integer('total_partially_dried')->default(0);
            $table->integer('total_not_dried')->default(0);
            $table->decimal('suggested_additional_hours', 4, 2)->nullable();
            $table->enum('overall_status', ['fully_dried','partially_dried','not_dried']);
            $table->timestamp('captured_at');
            $table->timestamps();
        });


    }

    public function down(): void
    {
        Schema::dropIfExists('capture_sessions');
    }
};
