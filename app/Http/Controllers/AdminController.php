<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

class AdminController extends Controller
{
    public function userManagement(Request $request)
    {
        $query = User::where('role', 'user');

        // Search
        if ($request->search) {
            $query->where(function ($q) use ($request) {
                $q->where('name', 'like', '%' . $request->search . '%')
                  ->orWhere('email', 'like', '%' . $request->search . '%')
                  ->orWhere('phone', 'like', '%' . $request->search . '%');
            });
        }

        $users = $query->orderBy('id', 'desc')->paginate(10);

        $totalUsers = User::where('role', 'user')->count();
        $activeUsers = User::where('role', 'user')
                            ->where('status', 'active')
                            ->count();
        $inactiveUsers = User::where('role', 'user')
                            ->where('status', 'inactive')
                            ->count();

        return view('admin-view.user-management', compact(
            'users',
            'totalUsers',
            'activeUsers',
            'inactiveUsers'
        ));
    }

    public function toggleUserStatus($id)
    {
        $user = User::findOrFail($id);

        if ($user->status === 'active') {
            $user->status = 'inactive';
        } else {
            $user->status = 'active';
        }

        $user->save();

        return response()->json([
            'success' => true
        ]);
    }


    public function updateUser(Request $request, $id)
    {
        $user = User::findOrFail($id);

        // ---------------- REMOVE IMAGE BUTTON ----------------
        if ($request->remove_image == "1") {

            if ($user->profile_picture &&
                Storage::disk('public')->exists($user->profile_picture)) {

                Storage::disk('public')->delete($user->profile_picture);
            }

            $user->profile_picture = null;
        }

        // ---------------- UPLOAD NEW IMAGE ----------------
        if ($request->hasFile('profile_picture')) {

            // 🔥 DELETE OLD IMAGE FIRST
            if ($user->profile_picture &&
                Storage::disk('public')->exists($user->profile_picture)) {

                Storage::disk('public')->delete($user->profile_picture);
            }

            $path = $request->file('profile_picture')
                ->store('profile_pictures', 'public');

            $user->profile_picture = $path;
        }

        // ---------------- NORMAL FIELDS ----------------
        $user->name = $request->name;
        $user->email = $request->email;
        $user->phone = $request->phone;
        $user->birthdate = $request->birthdate;
        $user->address = $request->address;

        if ($request->filled('password')) {
            $request->validate([
                'password' => 'confirmed|min:6'
            ]);
            $user->password = Hash::make($request->password);
        }

        $user->save();

        return response()->json(['success' => true,'message' => 'Profile changes saved']);

    }


    public function deleteUser($id)
    {
        $user = User::findOrFail($id);

        if ($user->profile_picture &&
            Storage::disk('public')->exists($user->profile_picture)) {
            Storage::disk('public')->delete($user->profile_picture);
        }

        $user->delete();

        return response()->json(['success' => true]);
    }



    public function bulkDeleteUsers(Request $request)
    {
        $ids = $request->ids;

        if (!$ids || !is_array($ids)) {
            return response()->json(['error' => 'Invalid request'], 400);
        }

        $users = User::whereIn('id', $ids)->get();

        foreach ($users as $user) {

            if ($user->profile_picture &&
                Storage::disk('public')->exists($user->profile_picture)) {

                Storage::disk('public')->delete($user->profile_picture);
            }
        }

        User::whereIn('id', $ids)->delete();

        return response()->json([
            'success' => true
        ]);
    }








}
