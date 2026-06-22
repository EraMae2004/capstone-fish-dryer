<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            if (! Schema::hasColumn('sensor_logs', 'log_type')) {
                $table->string('log_type', 32)->default('auto')->after('fan_speed');
            }
            if (! Schema::hasColumn('sensor_logs', 'check_label')) {
                $table->string('check_label', 64)->nullable()->after('log_type');
            }
        });
    }

    public function down(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            if (Schema::hasColumn('sensor_logs', 'check_label')) {
                $table->dropColumn('check_label');
            }
            if (Schema::hasColumn('sensor_logs', 'log_type')) {
                $table->dropColumn('log_type');
            }
        });
    }
};
