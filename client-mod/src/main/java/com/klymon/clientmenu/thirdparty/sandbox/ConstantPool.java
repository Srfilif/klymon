package com.klymon.clientmenu.thirdparty.sandbox;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Reads the class names a {@code .class} file references in its constant
 * pool. The sandbox scans every addon class with this before defining it so
 * forbidden references (I/O, reflection, the game) are rejected without ever
 * loading the offending class. Malformed input fails closed with
 * {@link IllegalArgumentException}.
 */
public final class ConstantPool {
    private ConstantPool() {
    }

    /**
     * Returns every referenced class in internal form
     * ({@code java/lang/String}).
     */
    public static Set<String> referencedClasses(byte[] classBytes) {
        Reader reader = new Reader(classBytes);
        if (reader.u4() != 0xCAFEBABE) {
            throw new IllegalArgumentException("not a class file (bad magic)");
        }
        reader.u2(); // minor version
        reader.u2(); // major version
        int count = reader.u2();
        if (count < 1) {
            throw new IllegalArgumentException("not a class file (bad constant pool count)");
        }
        String[] utf8 = new String[count];
        int[] classNameIndex = new int[count];
        for (int index = 1; index < count; index++) {
            int tag = reader.u1();
            switch (tag) {
                case 1 -> utf8[index] = reader.utf();
                case 3, 4 -> reader.skip(4);
                case 5, 6 -> {
                    reader.skip(8);
                    index++;
                }
                case 7 -> classNameIndex[index] = reader.u2();
                case 8, 16, 19, 20 -> reader.skip(2);
                case 9, 10, 11, 12, 17, 18 -> reader.skip(4);
                case 15 -> reader.skip(3);
                default -> throw new IllegalArgumentException("not a class file (bad constant pool tag " + tag + ")");
            }
        }
        Set<String> names = new HashSet<>();
        for (int index = 1; index < count; index++) {
            int nameIndex = classNameIndex[index];
            if (nameIndex != 0) {
                if (nameIndex < 1 || nameIndex >= count || utf8[nameIndex] == null) {
                    throw new IllegalArgumentException("not a class file (bad class name reference)");
                }
                names.add(utf8[nameIndex]);
            }
        }
        return names;
    }

    /** Bounds-checked big-endian cursor over the class bytes. */
    private static final class Reader {
        private final byte[] bytes;
        private int position;

        private Reader(byte[] bytes) {
            if (bytes == null) {
                throw new IllegalArgumentException("class bytes must not be null");
            }
            this.bytes = bytes;
        }

        private int u1() {
            require(1);
            return bytes[position++] & 0xFF;
        }

        private int u2() {
            require(2);
            int value = ((bytes[position] & 0xFF) << 8) | (bytes[position + 1] & 0xFF);
            position += 2;
            return value;
        }

        private int u4() {
            require(4);
            int value = ((bytes[position] & 0xFF) << 24)
                    | ((bytes[position + 1] & 0xFF) << 16)
                    | ((bytes[position + 2] & 0xFF) << 8)
                    | (bytes[position + 3] & 0xFF);
            position += 4;
            return value;
        }

        private String utf() {
            int length = u2();
            require(length);
            String value = new String(bytes, position, length, StandardCharsets.UTF_8);
            position += length;
            return value;
        }

        private void skip(int length) {
            require(length);
            position += length;
        }

        private void require(int length) {
            if (length < 0 || position < 0 || position + length > bytes.length) {
                throw new IllegalArgumentException("not a class file (truncated)");
            }
        }
    }
}
