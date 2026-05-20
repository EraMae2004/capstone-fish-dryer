<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('microcontrollers')) {
            Schema::create('microcontrollers', function (Blueprint $table) {
                $table->id();
                $table->string('device_id')->unique();
                $table->string('mac', 12)->nullable()->unique();
                $table->string('display_name')->nullable();
                $table->timestamp('last_seen')->nullable();
                $table->foreignId('created_by')->constrained('users')->onDelete('cascade');
                $table->timestamps();
            });

            return;
        }

        // DB already had `microcontrollers` from an older run; only add missing columns.
        if (! Schema::hasColumn('microcontrollers', 'mac')) {
            Schema::table('microcontrollers', function (Blueprint $table) {
                $table->string('mac', 12)->nullable()->after('device_id');
            });
            Schema::table('microcontrollers', function (Blueprint $table) {
                $table->unique('mac');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('microcontrollers')) {
            return;
        }

        if (Schema::hasColumn('microcontrollers', 'mac')) {
            Schema::table('microcontrollers', function (Blueprint $table) {
                $table->dropUnique(['mac']);
            });
            Schema::table('microcontrollers', function (Blueprint $table) {
                $table->dropColumn('mac');
            });
        }
    }
};

