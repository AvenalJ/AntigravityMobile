package de.xyourp.antigravitymobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory

/** Builds a [ViewModelProvider.Factory] that constructs [VM] from a lambda. */
inline fun <reified VM : ViewModel> appViewModelFactory(
    crossinline create: () -> VM,
): ViewModelProvider.Factory = viewModelFactory {
    initializer { create() }
}
