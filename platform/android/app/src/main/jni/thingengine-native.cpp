#include <cstdlib>
#include <cstdint>

#include <jni.h>

#include <unistd.h>
#include <sys/eventfd.h>

extern "C" {

JNIEXPORT void JNICALL
Java_edu_stanford_thingengine_engine_NativeSyncFlag_init(JNIEnv *env, jobject self)
{
    int fd = eventfd(0, EFD_CLOEXEC);
    if (fd < 0) {
        int saved_errno = errno;
        jclass ioexeception = env->FindClass("java/io/IOException");
        env->ThrowNew(ioexeception, strerror(saved_errno));
        return;
    }

    jclass nativesyncflag = env->GetObjectClass(self);
    jfieldID field = env->GetFieldID(nativesyncflag, "fd", "I");
    env->SetIntField(self, field, fd);
}

JNIEXPORT void JNICALL
Java_edu_stanford_thingengine_engine_NativeSyncFlag_signalFD(JNIEnv *env, jclass class_, int fd)
{
    uint64_t value = 1;
    int ok = write(fd, (const char*)&value, sizeof(value));
    if (ok < 0) {
        int saved_errno = errno;
        jclass ioexeception = env->FindClass("java/io/IOException");
        env->ThrowNew(ioexeception, strerror(saved_errno));
    }
}

JNIEXPORT void JNICALL
Java_edu_stanford_thingengine_engine_NativeSyncFlag_closeFD(JNIEnv *env, jclass class_, int fd)
{
    int ok = close(fd);
    if (ok < 0) {
        int saved_errno = errno;
        jclass ioexeception = env->FindClass("java/io/IOException");
        env->ThrowNew(ioexeception, strerror(saved_errno));
    }
}

}