<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'profile_picture',
        'name',
        'birthdate',
        'address',
        'phone',
        'email',
        'password',
        'role',
        'status',

    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'birthdate' => 'date',
    ];

    public function machines()
    {
        return $this->hasMany(Machine::class, 'created_by');
    }

    public function dryingBatches()
    {
        return $this->hasMany(DryingBatch::class);
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class);
    }

}
